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

/** Ensures the approved workspace product structure using the same authenticated request client. */
export async function bootstrapApprovedWorkspace(
  client: SupabaseClient,
  slug: string,
  prelude?: BootstrapEntryPrelude,
): Promise<void> {
  const timer = createEntryTimer();
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
  const ctx: Ctx = { user, org, role: memberRole, scope: memberScope };
  const assignees = assigneesFromMemberSummary(
    await timer.time("member-summary", () => loadMemberOrgSummaryWithClient(client, ctx)),
  );
  if (assignees.length === 0) throw new Error("workspace bootstrap assignees unavailable");

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
      const boards = await store.listBoards(ctx);
      const drifts = await Promise.all(DEFAULT_TABS.map((tab) => {
        const matches = boards.filter((board) => board.source === tab.source);
        if (matches.length !== 1) return { hasWork: true };
        return readDefaultTabBootstrapDrift(ctx, tab, matches[0], store, assignees);
      }));
      return drifts.every((drift) => !drift.hasWork);
    });
    if (clean) {
      logEntryTimings("workspace-bootstrap", timer.snapshot(), "fast-skip");
      return;
    }
  } catch {
    // Fall through: the slow path re-reads and owns every error shape.
  }

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
}

/**
 * Repairs a manually-approved workspace when its creator first enters it.
 * Legacy/customer workspaces without an approved create request are never backfilled.
 */
export async function ensureApprovedWorkspaceOnEntry(client: SupabaseClient, slug: string): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error("workspace bootstrap context unavailable");
  const orgResult = await client.from("orgs").select("id,name,plan_tier,created_at").eq("slug", slug).maybeSingle();
  const orgId = text((orgResult.data as Row | null)?.id);
  if (orgResult.error || !orgId) throw new Error("workspace bootstrap context unavailable");

  const requestResult = await client.rpc("is_my_approved_workspace_creator", {
    p_org_id: orgId,
  });
  if (requestResult.error) throw new Error("workspace bootstrap approval unavailable");
  if (requestResult.data !== true) return;
  await bootstrapApprovedWorkspace(client, slug, {
    authUser: auth.user as PreludeAuthUser,
    orgRow: orgResult.data as Row,
  });
}
