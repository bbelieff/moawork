import { parseActiveMembershipRows } from "@/lib/auth/workspace-routing";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

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
  // Supabase 미설정(로컬 dev 세션)에서는 원격 조회 자체가 없다. 예전엔 여기서 createClient() 가
  // 던져 (app) 레이아웃 전체가 500 이 났고, 그래서 로그인한 화면을 «눈으로 볼» 방법이 없었다
  // — 여러 세션의 촬영 NOT_RUN 이 이 한 줄 때문이다. loadNotifySnapshot·loadLockedFeatures 와
  // 같은 규약으로 «조회 불가» 스냅샷을 돌려준다. 호출부는 이미 ready 아님을 처리한다.
  if (!hasSupabaseEnv()) return { kind: "unauthenticated" };
  const client = await createClient();
  return readWorkspaceRoutingSnapshot(client as unknown as WorkspaceAuthClient);
}
