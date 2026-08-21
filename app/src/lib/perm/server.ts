import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSession } from "@/lib/auth/session";
import { BoardsService } from "@/lib/boards/service";
import { roleDefaultAllowed } from "./resolve";
import { isRole, type Role } from "./matrix";

export type PermMatrixRow = {
  group: string;
  scopeKey: string;
  label: string;
  danger: boolean;
  allowed: { owner: boolean; admin: boolean; team_lead: boolean; member: boolean };
};

export type PermMatrixException = {
  userId: string;
  scopeKey: string;
  decision: "allow" | "deny";
  accessLevel: "viewer" | "editor";
};

export type PermMatrixSnapshot = {
  matrix: PermMatrixRow[];
  exceptions: PermMatrixException[];
};

export type ScopedWorkItems = { itemIds: string[]; hiddenCount: number };

export function parseScopedWorkItems(data: unknown): ScopedWorkItems | null {
  if (!data || typeof data !== "object") return null;
  const row = data as { itemIds?: unknown; hiddenCount?: unknown };
  if (!Array.isArray(row.itemIds) || !row.itemIds.every((id) => typeof id === "string")) return null;
  if (!Number.isInteger(row.hiddenCount) || (row.hiddenCount as number) < 0) return null;
  return { itemIds: row.itemIds as string[], hiddenCount: row.hiddenCount as number };
}

/** D24: DB가 조회 범위를 먼저 적용한 뒤 선택 뷰와 숨김 건수를 반환한다. */
export async function loadPermissionScopedWorkItems(
  orgId: string,
  viewAssignee: string | null = null,
): Promise<{ ok: true; result: ScopedWorkItems } | { ok: false; reason: "permission" | "unavailable" }> {
  // ★ BBE-207 — 개발 빌드 + Supabase 없음. 여기도 createClient() 가 던져 «판정 불능» 이 됐고
  //   boards/[id] 가 그걸 404 로 접었다. 권한(위)만 고쳐서는 이 화면이 안 열린다.
  //
  //   ★ 넓히지 않는다. 조회 범위가 «회사 전체»(scope: all) 인 경우에만 로컬에서 계산하고,
  //     좁은 범위(assigned 등)는 **로컬에서 계산하지 않고 닫아 둔다** — D24 범위를 손으로
  //     흉내 내다 틀리면 그게 곧 정보 노출이다. 모르면 닫는다.
  if (process.env.NODE_ENV !== "production" && !hasSupabaseEnv()) {
    const ctx = await getSession();
    if (ctx.scope !== "all") return { ok: false, reason: "unavailable" };
    const boards = new BoardsService();
    const visible = await boards.listBoards(ctx);
    const perBoard = await Promise.all(visible.map((board) => boards.listItems(ctx, board.id)));
    return {
      ok: true,
      result: { itemIds: perBoard.flat().map((item) => item.id), hiddenCount: 0 },
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("read_permission_scoped_work_items", {
      p_org_id: orgId,
      p_view_assignee: viewAssignee,
    });
    if (error) return { ok: false, reason: permAccessReasonFromRpcError(error as { code?: string }) };
    const result = parseScopedWorkItems(data);
    return result ? { ok: true, result } : { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

type RpcResult<T> = { data: T | null; error: unknown };

export function parseEffectivePermissions(
  data: unknown,
  scopeKeys: readonly string[],
): Record<string, boolean> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (Object.keys(row).length !== scopeKeys.length
    || scopeKeys.some((scopeKey) => typeof row[scopeKey] !== "boolean")) return null;
  return row as Record<string, boolean>;
}

/** 42501(insufficient_privilege) = 권한 없음. 그 외 에러는 장애 — BBE-90 과 같은 분류 규약. */
export function permAccessReasonFromRpcError(
  error: { code?: string | null } | null | undefined,
): "permission" | "unavailable" {
  return (error?.code ?? "") === "42501" ? "permission" : "unavailable";
}

/**
 * 권한은 보안 경계다(엔타이틀먼트와 다르다 — entitlements/server.ts 의 "실패 시 기본값으로
 * 열어준다"를 여기서 따라하지 않는다). 조회 실패는 곧 **불허**로 수렴한다.
 * 화면에서 "권한 없음"과 "장애"를 구분하는 것은 guard.ts 몫이다.
 */
export async function loadEffectivePermission(
  orgId: string,
  scopeKey: string,
): Promise<{ allowed: boolean; ok: true } | { ok: false }> {
  // ★ BBE-207 — 개발 빌드 + Supabase 없음에서만 로컬 시드 역할로 «판정» 한다.
  //
  //   그동안 이 경로는 createClient() 가 던져 { ok:false } → denied/unavailable 이 됐고,
  //   그래서 로컬에서 보드 화면이 열리지 않았다(권한 조회가 «실패» 하니 통과할 방법이 없었다).
  //
  //   ★ 전부 허용하지 않는다. `roleDefaultAllowed` 로 **역할 기본값을 그대로 계산**한다 —
  //     운영에서 쓰는 것과 같은 표(matrix.ts)이고, 모르는 scopeKey 는 false(닫힘)다.
  //     즉 로컬에서도 member 는 여전히 owner 전용 기능을 못 연다. fail-closed 는 유지된다.
  //
  //   ★ 조건을 여기 «인라인» 으로 적는다. 함수로 감싸면 경계 검사기
  //     (scripts/check-production-repo-boundaries.mjs 의 isInsideExplicitDevGuard)가
  //     읽지 못해 운영 위반으로 세어진다 — 그 문법 자체가 「운영에서 도달 불가」의 증명이다.
  if (process.env.NODE_ENV !== "production" && !hasSupabaseEnv()) {
    const ctx = await getSession();
    if (!isRole(ctx.role)) return { ok: false };
    return { ok: true, allowed: roleDefaultAllowed(ctx.role, scopeKey) };
  }

  try {
    const supabase = await createClient();
    const { data, error }: RpcResult<boolean> = await supabase.rpc("effective_permission", {
      p_org_id: orgId,
      p_scope_key: scopeKey,
    });
    if (error || typeof data !== "boolean") {
      return { ok: false };
    }
    return { ok: true, allowed: data };
  } catch {
    return { ok: false };
  }
}

export async function loadEffectivePermissions(
  orgId: string,
  scopeKeys: readonly string[],
): Promise<{ permissions: Record<string, boolean>; ok: true } | { ok: false }> {
  if (scopeKeys.length === 0 || new Set(scopeKeys).size !== scopeKeys.length) return { ok: false };
  if (process.env.NODE_ENV !== "production" && !hasSupabaseEnv()) {
    const ctx = await getSession();
    if (!isRole(ctx.role)) return { ok: false };
    return {
      ok: true,
      permissions: Object.fromEntries(scopeKeys.map((scopeKey) => [scopeKey, roleDefaultAllowed(ctx.role, scopeKey)])),
    };
  }

  try {
    const supabase = await createClient();
    const { data, error }: RpcResult<unknown> = await supabase.rpc("effective_permissions", {
      p_org_id: orgId,
      p_scope_keys: [...scopeKeys],
    });
    if (error) return { ok: false };
    const permissions = parseEffectivePermissions(data, scopeKeys);
    return permissions ? { ok: true, permissions } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** 조직관리 → 권한 화면용 전체 매트릭스. 소유자·관리자만 호출 가능(RPC 가 강제). */
export async function loadPermissionMatrix(
  orgId: string,
): Promise<{ ok: true; snapshot: PermMatrixSnapshot } | { ok: false; reason: "permission" | "unavailable" }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("read_org_permission_matrix", { p_org_id: orgId });
    if (error) {
      return { ok: false, reason: permAccessReasonFromRpcError(error as { code?: string }) };
    }
    if (!data || typeof data !== "object" || !Array.isArray((data as PermMatrixSnapshot).matrix)) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, snapshot: data as PermMatrixSnapshot };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function writeRolePermission(
  orgId: string,
  role: Role,
  scopeKey: string,
  allowed: boolean,
  requestId: string,
): Promise<{ ok: boolean }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("write_org_role_permission", {
      p_org_id: orgId,
      p_role: role,
      p_scope_key: scopeKey,
      p_allowed: allowed,
      p_request_id: requestId,
    });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export async function bindMemberPermissionException(
  orgId: string,
  targetUserId: string,
  scopeKey: string,
  decision: "allow" | "deny",
  accessLevel: "viewer" | "editor",
  requestId: string,
): Promise<{ ok: boolean }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("bind_workspace_member_permission_exception", {
      p_org_id: orgId,
      p_target_user_id: targetUserId,
      p_scope_key: scopeKey,
      p_decision: decision,
      p_access_level: accessLevel,
      p_request_id: requestId,
    });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** 위험 5항목 실행 기록. 호출 전 effective_permission 을 다시 확인하지 않는다 — RPC 가 자체 강제한다. */
export async function recordRiskyAction(
  orgId: string,
  scopeKey: string,
  metadata: Record<string, unknown> = {},
): Promise<{ ok: boolean }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_risky_action", {
      p_org_id: orgId,
      p_scope_key: scopeKey,
      p_metadata: metadata,
    });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
