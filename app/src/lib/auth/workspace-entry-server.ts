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
  // Supabase 환경변수가 없는 로컬 개발에서는 스냅샷을 «없음» 으로 돌려준다.
  //
  // 왜 필요한가 — `createClient()` 는 env 가 없으면 **던진다**. 이 함수는 `(app)/layout.tsx`
  // 가 조건 없이 부르므로, env 없는 로컬에서는 (app) 아래 **모든 화면이 500** 이 됐다.
  // 그래서 C 진영이 화면을 눈으로 확인할 수가 없었다(AGENTS.md §3 이 요구하는 바로 그 증거).
  // env 를 채우면 되지 않느냐 — 안 된다. `getSessionOrNull()` 이 `hasSupabaseEnv()` 로
  // 분기해서, 가짜 값이라도 채우면 개발용 계정 로그인이 통째로 꺼진다.
  //
  // 프로덕션에는 영향이 없다(env 가 항상 있으므로 아래 경로 그대로).
  // 반환값도 새로 만들지 않는다 — 이미 있는 `unauthenticated` 를 쓴다. 호출부
  // (`layout.tsx`)는 `kind !== "ready"` 를 빈 목록으로 처리하도록 이미 짜여 있다.
  if (!hasSupabaseEnv()) return { kind: "unauthenticated" };
  const client = await createClient();
  return readWorkspaceRoutingSnapshot(client as unknown as WorkspaceAuthClient);
}
