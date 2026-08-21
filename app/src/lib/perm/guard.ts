// 권한 없음 vs 장애 구분 — platform/guard.ts(BBE-90)와 같은 규약을 perm 도메인에 적용한다.
//
// "권한이 없어 못 보는 것"과 "장애로 못 보는 것"은 화면에서 달라야 한다(카드 수용 기준).
// fail-closed: RPC 가 애매하거나 실패하면 **허용하지 않는다** — 판정 불능은 unavailable 이지
// allowed 로 승격하지 않는다.

import { loadEffectivePermission, loadEffectivePermissions } from "./server";

export type PermGuardResult =
  | { kind: "allowed" }
  | { kind: "denied"; reason: "permission" }
  | { kind: "denied"; reason: "unavailable" };

export async function loadPermGuard(orgId: string, scopeKey: string): Promise<PermGuardResult> {
  const result = await loadEffectivePermission(orgId, scopeKey);
  if (!result.ok) {
    return { kind: "denied", reason: "unavailable" };
  }
  return result.allowed ? { kind: "allowed" } : { kind: "denied", reason: "permission" };
}

export async function loadPermGuards(
  orgId: string,
  scopeKeys: readonly string[],
): Promise<Record<string, PermGuardResult>> {
  const result = await loadEffectivePermissions(orgId, scopeKeys);
  return Object.fromEntries(scopeKeys.map((scopeKey) => {
    if (!result.ok) return [scopeKey, { kind: "denied", reason: "unavailable" } satisfies PermGuardResult];
    return [scopeKey, result.permissions[scopeKey]
      ? { kind: "allowed" }
      : { kind: "denied", reason: "permission" } satisfies PermGuardResult];
  }));
}
