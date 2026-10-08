import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TABS, ensureDefaultTabs, readDefaultTabBootstrapDrift } from "@/lib/default-tabs";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import type { Ctx, MemberRole, MemberScope, Org, User } from "@/lib/types";
import { assigneesFromMemberSummary } from "@/lib/boards/default-tab-assignees";
import { loadMemberOrgSummaryWithClient } from "@/lib/auth/member-org-summary";
import type { BoardsRepo } from "@/lib/boards/store";
import { createEntryTimer, logEntryTimings } from "@/lib/entry-timing";

type Row = Record<string, unknown>;
const BOOTSTRAP_LEASE_ATTEMPTS = 40;
const BOOTSTRAP_LEASE_WAIT_MS = 250;
const BOOTSTRAP_LEASE_HEARTBEAT_MS = 10_000;

function guardedRepo(repo: BoardsRepo, assertLease: () => Promise<void>): BoardsRepo {
  return new Proxy(repo, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        await assertLease();
        return value.apply(target, args);
      };
    },
  }) as BoardsRepo;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function role(value: unknown): MemberRole | null {
  return value === "owner" || value === "admin" || value === "team_lead" || value === "member" ? value : null;
}

function scope(value: unknown): MemberScope | null {
  return value === "all" || value === "department" || value === "assigned" ? value : null;
}

type PreludeAuthUser = {
  id: string;
  email?: string | null;
  created_at: string;
  user_metadata?: Record<string, unknown>;
};

/**
 * Same-request prelude from ensureApprovedWorkspaceOnEntry: it already fetched
 * the caller and the org row on this exact client, so the bootstrap does not
 * pay getUser + orgs a second time. Fresh per request — never cached across
 * requests — so authorization stays as fresh as before, with fewer hops.
 */
export type BootstrapEntryPrelude = {
  authUser: PreludeAuthUser;
  orgRow: Row;
};

/**
 * Issue 857 — 이 요청에서 이미 검증된 세션(getSession: 사용자·활성 멤버십·회사).
 * 앱 레이아웃이 넘기면 getUser·회사 주소 조회·멤버십 재확인 3번을 건너뛴다. 같은 요청의 값이라
 * 권한 회수는 그대로 바로 반영된다(요청을 넘어 저장하지 않는다).
 */
export type BootstrapVerifiedSession = { ctx: Ctx };

/** 점검 결과 — repaired 면 이 요청에서 보드 구조를 고쳤다(먼저 읽어 둔 보드 목록은 낡았다). */
export type BootstrapOutcome = "skipped" | "clean" | "repaired";

/** Ensures the approved workspace product structure using the same authenticated request client. */
export async function bootstrapApprovedWorkspace(
  client: SupabaseClient,
  slug: string,
  prelude?: BootstrapEntryPrelude,
  verified?: BootstrapVerifiedSession,
): Promise<Exclude<BootstrapOutcome, "skipped">> {
  const timer = createEntryTimer();
  const ctx = verified?.ctx ?? await loadBootstrapCtx(client, slug, prelude, timer);
  return bootstrapWithCtx(client, ctx, timer);
}

async function loadBootstrapCtx(
  client: SupabaseClient,
  slug: string,
  prelude: BootstrapEntryPrelude | undefined,
  timer: ReturnType<typeof createEntryTimer>,
): Promise<Ctx> {
  const loaded = prelude
    ? { authUser: prelude.authUser as PreludeAuthUser | null, orgRow: prelude.orgRow as Row | null, orgError: null as unknown }
    : await timer.time("bootstrap-context", async () => {
      const [{ data: auth }, orgResult] = await Promise.all([
        client.auth.getUser(),
        client.from("orgs").select("id,name,plan_tier,created_at").eq("slug", slug).maybeSingle(),
      ]);
      return { authUser: auth.user as PreludeAuthUser | null, orgRow: orgResult.data as Row | null, orgError: orgResult.error };
    });
  const authUser = loaded.authUser;
  const orgRow = loaded.orgRow;
  if (!authUser || loaded.orgError || !orgRow) throw new Error("workspace bootstrap context unavailable");

  const orgId = text(orgRow.id);
  if (!orgId) throw new Error("workspace bootstrap context unavailable");
  const membershipResult = await timer.time("membership", () => client
    .from("org_members")
    .select("role,scope,status")
    .eq("org_id", orgId)
    .eq("user_id", authUser.id)
    .eq("status", "active")
    .maybeSingle());
  const membership = membershipResult.data as Row | null;
  const memberRole = role(membership?.role);
  const memberScope = scope(membership?.scope);
  if (membershipResult.error || !membership || !memberRole || !memberScope) {
    throw new Error("workspace bootstrap membership unavailable");
  }

  const user: User = {
    id: authUser.id,
    email: authUser.email ?? null,
    name: text((authUser.user_metadata as Record<string, unknown> | undefined)?.name)
      ?? text((authUser.user_metadata as Record<string, unknown> | undefined)?.full_name)
      ?? authUser.email ?? null,
    avatar_url: text((authUser.user_metadata as Record<string, unknown> | undefined)?.avatar_url),
    created_at: authUser.created_at,
  };
  const org: Org = {
    id: orgId,
    name: text(orgRow.name) ?? slug,
    plan_tier: text(orgRow.plan_tier) ?? "free",
    created_at: text(orgRow.created_at) ?? new Date(0).toISOString(),
  };
  return { user, org, role: memberRole, scope: memberScope };
}

async function bootstrapWithCtx(
  client: SupabaseClient,
  ctx: Ctx,
  timer: ReturnType<typeof createEntryTimer>,
): Promise<Exclude<BootstrapOutcome, "skipped">> {
  const orgId = ctx.org.id;
  // Issue 857 — 담당자 목록과 보드 목록은 서로 기다릴 이유가 없어 같이 출발한다.
  const summaryRead = timer.time("member-summary", () => loadMemberOrgSummaryWithClient(client, ctx));
  summaryRead.catch(() => undefined);

  // Fast path — the common repeat entry. Read-only drift probe over all four
  // tabs (one boards list, per-board reads in parallel, using the complete
  // bootstrap reconciler). Clean means: no lease, no writes, no per-op renewals.
  // Anything else — missing/conflict/drift/read error — falls through to the
  // lease-guarded repair below, which stays authoritative. One repo instance
  // serves both paths; the slow path only adds the lease guard, never a
  // second client binding.
  const plainRepo = new SupabaseBoardsRepo(client);
  try {
    const clean = await timer.time("fast-drift-check", async () => {
      const store = plainRepo;
      const [summary, boards] = await Promise.all([summaryRead, store.listBoards(ctx)]);
      const assignees = assigneesFromMemberSummary(summary);
      if (assignees.length === 0) throw new Error("workspace bootstrap assignees unavailable");
      // #849 — 회사가 지운 기본 탭은 «깨끗함» 이다(리스도, 다시 만들기도 없다).
      //   지운 기록은 빠진 탭이 있을 때만 읽는다 — 건강한 진입에 왕복을 더하지 않는다.
      const anyMissing = DEFAULT_TABS.some((tab) => !boards.some((board) => board.source === tab.source));
      const dismissed = new Set(anyMissing ? (await store.listDefaultTabDismissals(ctx)).map((row) => row.source) : []);
      const drifts = await Promise.all(DEFAULT_TABS.map((tab) => {
        const matches = boards.filter((board) => board.source === tab.source);
        if (matches.length === 0 && dismissed.has(tab.source)) return { hasWork: false };
        if (matches.length !== 1) return { hasWork: true };
        return readDefaultTabBootstrapDrift(ctx, tab, matches[0], store, assignees);
      }));
      return drifts.every((drift) => !drift.hasWork);
    });
    if (clean) {
      logEntryTimings("workspace-bootstrap", timer.snapshot(), "fast-skip");
      return "clean";
    }
  } catch {
    // Fall through: the slow path re-reads and owns every error shape.
  }

  const assignees = assigneesFromMemberSummary(await summaryRead);
  if (assignees.length === 0) throw new Error("workspace bootstrap assignees unavailable");
  const holder = crypto.randomUUID();
  await timer.time("lease-repair", async () => {
    let acquired = false;
    for (let attempt = 0; attempt < BOOTSTRAP_LEASE_ATTEMPTS; attempt += 1) {
      const result = await client.rpc("acquire_workspace_bootstrap_lease", {
        p_org_id: orgId,
        p_holder: holder,
      });
      if (result.error) throw new Error("workspace bootstrap lease unavailable");
      if (result.data === true) {
        acquired = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_LEASE_WAIT_MS));
    }
    if (!acquired) throw new Error("workspace bootstrap lease unavailable");
    let leaseLost = false;
    let renewing = false;
    const renew = async () => {
      if (leaseLost) throw new Error("workspace bootstrap lease lost");
      const result = await client.rpc("renew_workspace_bootstrap_lease", {
        p_org_id: orgId,
        p_holder: holder,
      });
      if (result.error || result.data !== true) {
        leaseLost = true;
        throw new Error("workspace bootstrap lease lost");
      }
    };
    const heartbeat = setInterval(() => {
      if (renewing || leaseLost) return;
      renewing = true;
      void renew().catch(() => undefined).finally(() => { renewing = false; });
    }, BOOTSTRAP_LEASE_HEARTBEAT_MS);
    try {
      await renew();
      await ensureDefaultTabs(ctx, guardedRepo(plainRepo, renew), assignees);
      await renew();
    } finally {
      clearInterval(heartbeat);
      const released = await client.rpc("release_workspace_bootstrap_lease", {
        p_org_id: orgId,
        p_holder: holder,
      });
      if (released.error) throw new Error("workspace bootstrap lease release unavailable");
    }
  });
  logEntryTimings("workspace-bootstrap", timer.snapshot(), "repaired");
  return "repaired";
}

/**
 * Repairs a manually-approved workspace when its creator first enters it.
 * Legacy/customer workspaces without an approved create request are never backfilled.
 */
export async function ensureApprovedWorkspaceOnEntry(
  client: SupabaseClient,
  slug: string,
  verified?: BootstrapVerifiedSession,
): Promise<BootstrapOutcome> {
  if (verified) {
    const requestResult = await client.rpc("is_my_approved_workspace_creator", { p_org_id: verified.ctx.org.id });
    if (requestResult.error) throw new Error("workspace bootstrap approval unavailable");
    if (requestResult.data !== true) return "skipped";
    return bootstrapApprovedWorkspace(client, slug, undefined, verified);
  }
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error("workspace bootstrap context unavailable");
  const orgResult = await client.from("orgs").select("id,name,plan_tier,created_at").eq("slug", slug).maybeSingle();
  const orgId = text((orgResult.data as Row | null)?.id);
  if (orgResult.error || !orgId) throw new Error("workspace bootstrap context unavailable");

  const requestResult = await client.rpc("is_my_approved_workspace_creator", {
    p_org_id: orgId,
  });
  if (requestResult.error) throw new Error("workspace bootstrap approval unavailable");
  if (requestResult.data !== true) return "skipped";
  return bootstrapApprovedWorkspace(client, slug, {
    authUser: auth.user as PreludeAuthUser,
    orgRow: orgResult.data as Row,
  });
}
