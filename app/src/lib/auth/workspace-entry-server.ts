import { parseActiveMembershipRows } from "@/lib/auth/workspace-routing";
import { createClient } from "@/lib/supabase/server";

export type WorkspaceEntryOption = {
  orgId: string;
  slug: string;
  name: string;
  role: "owner" | "admin" | "member";
};

export type WorkspaceRoutingSnapshot =
  | { kind: "unauthenticated" }
  | { kind: "error" }
  | {
      kind: "ready";
      memberships: WorkspaceEntryOption[];
      /** Real loader always sets this; an absent injected snapshot must fail closed at entry. */
      selfRouteState?: "eligible_entry" | "blocked_inactive";
    };

type WorkspaceAuthClient = {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
  from(table: "org_members"): {
    select(columns: string): {
      eq(column: "user_id", value: string): {
        order(column: "created_at", options: { ascending: true }): Promise<{
          data: unknown;
          error: unknown;
        }>;
      };
    };
  };
  rpc(name: "workspace_entry_self_route_state"): Promise<{
    data: unknown;
    error: unknown;
  }>;
};

function relation(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : null;
}

/** Auth-only loader. It deliberately does not require or infer mw_org. */
export async function readWorkspaceRoutingSnapshot(
  client: WorkspaceAuthClient,
): Promise<WorkspaceRoutingSnapshot> {
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError || !user) return { kind: "unauthenticated" };

  const [membershipResult, selfStateResult] = await Promise.all([
    client
      .from("org_members")
      .select(
        "org_id, status, role, scope, created_at, orgs!inner(id, slug, status, name, plan_tier, created_at)",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    client.rpc("workspace_entry_self_route_state"),
  ]);
  if (membershipResult.error || selfStateResult.error) return { kind: "error" };
  const selfRouteState = selfStateResult.data;
  if (selfRouteState !== "eligible_entry" && selfRouteState !== "blocked_inactive") return { kind: "error" };

  const parsed = parseActiveMembershipRows(membershipResult.data);
  if (!parsed.ok) return { kind: "error" };

  const memberships: WorkspaceEntryOption[] = [];
  for (const membership of parsed.memberships) {
    const org = relation(membership.source.orgs);
    const name = org && typeof org.name === "string" ? org.name.trim() : "";
    if (!name) return { kind: "error" };
    const role = membership.source.role;
    if (role !== "owner" && role !== "admin" && role !== "member") return { kind: "error" };
    memberships.push({ orgId: membership.orgId, slug: membership.slug, name, role });
  }
  return { kind: "ready", memberships, selfRouteState };
}

export async function loadWorkspaceRoutingSnapshot(): Promise<WorkspaceRoutingSnapshot> {
  const client = await createClient();
  return readWorkspaceRoutingSnapshot(client as unknown as WorkspaceAuthClient);
}
