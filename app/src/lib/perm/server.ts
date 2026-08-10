import { createClient } from "@/lib/supabase/server";
import type { Role } from "./matrix";

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

type RpcResult<T> = { data: T | null; error: unknown };

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
