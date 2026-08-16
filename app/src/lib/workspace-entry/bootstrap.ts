import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureDefaultTabs } from "@/lib/default-tabs";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import type { Ctx, MemberRole, MemberScope, Org, User } from "@/lib/types";
import { assigneesFromMemberSummary } from "@/lib/boards/default-tab-assignees";
import { loadMemberOrgSummaryWithClient } from "@/lib/auth/member-org-summary";
import type { BoardsRepo } from "@/lib/boards/store";

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

/** Ensures the approved workspace product structure using the same authenticated request client. */
export async function bootstrapApprovedWorkspace(client: SupabaseClient, slug: string): Promise<void> {
  const [{ data: auth }, orgResult] = await Promise.all([
    client.auth.getUser(),
    client.from("orgs").select("id,name,plan_tier,created_at").eq("slug", slug).maybeSingle(),
  ]);
  const authUser = auth.user;
  const orgRow = orgResult.data as Row | null;
  if (!authUser || orgResult.error || !orgRow) throw new Error("workspace bootstrap context unavailable");

  const orgId = text(orgRow.id);
  if (!orgId) throw new Error("workspace bootstrap context unavailable");
  const membershipResult = await client
    .from("org_members")
    .select("role,scope,status")
    .eq("org_id", orgId)
    .eq("user_id", authUser.id)
    .eq("status", "active")
    .maybeSingle();
  const membership = membershipResult.data as Row | null;
  const memberRole = role(membership?.role);
  const memberScope = scope(membership?.scope);
  if (membershipResult.error || !membership || !memberRole || !memberScope) {
    throw new Error("workspace bootstrap membership unavailable");
  }

  const user: User = {
    id: authUser.id,
    email: authUser.email ?? null,
    name: text(authUser.user_metadata?.name) ?? text(authUser.user_metadata?.full_name) ?? authUser.email ?? null,
    avatar_url: text(authUser.user_metadata?.avatar_url),
    created_at: authUser.created_at,
  };
  const org: Org = {
    id: orgId,
    name: text(orgRow.name) ?? slug,
    plan_tier: text(orgRow.plan_tier) ?? "free",
    created_at: text(orgRow.created_at) ?? new Date(0).toISOString(),
  };
  const ctx: Ctx = { user, org, role: memberRole, scope: memberScope };
  const assignees = assigneesFromMemberSummary(await loadMemberOrgSummaryWithClient(client, ctx));
  if (assignees.length === 0) throw new Error("workspace bootstrap assignees unavailable");
  const holder = crypto.randomUUID();
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
    await ensureDefaultTabs(ctx, guardedRepo(new SupabaseBoardsRepo(client), renew), assignees);
    await renew();
  } finally {
    clearInterval(heartbeat);
    const released = await client.rpc("release_workspace_bootstrap_lease", {
      p_org_id: orgId,
      p_holder: holder,
    });
    if (released.error) throw new Error("workspace bootstrap lease release unavailable");
  }
}

/**
 * Repairs a manually-approved workspace when its creator first enters it.
 * Legacy/customer workspaces without an approved create request are never backfilled.
 */
export async function ensureApprovedWorkspaceOnEntry(client: SupabaseClient, slug: string): Promise<void> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error("workspace bootstrap context unavailable");
  const orgResult = await client.from("orgs").select("id").eq("slug", slug).maybeSingle();
  const orgId = text((orgResult.data as Row | null)?.id);
  if (orgResult.error || !orgId) throw new Error("workspace bootstrap context unavailable");

  const requestResult = await client.rpc("is_my_approved_workspace_creator", {
    p_org_id: orgId,
  });
  if (requestResult.error) throw new Error("workspace bootstrap approval unavailable");
  if (requestResult.data !== true) return;
  await bootstrapApprovedWorkspace(client, slug);
}
