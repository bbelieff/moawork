// 권한 판정 — **순수 로직**(DB 접근 없음. 서버 조회는 server.ts 가 맡는다).
//
// 순서: 역할 기본값(matrix.ts) → 조직별 역할 오버라이드 → 개인 예외(차단이 허용을 이김).
// 소유자는 항상 true — 끌 수 없다. supabase/migrations/055_permission_role_matrix.sql 의
// effective_permission() 과 반드시 같은 결과를 내야 한다(SQL 이 보안 경계, 이 모듈은
// 화면 렌더용 미리보기·테스트 편의를 위한 미러).

import { type Role, findPermItem } from "./matrix";

export type RoleOverride = { role: Role; scopeKey: string; allowed: boolean };
export type MemberException = { userId: string; scopeKey: string; decision: "allow" | "deny" };

const ROLE_INDEX: Record<Role, number> = { owner: 0, admin: 1, team_lead: 2, member: 3 };

/** 역할 기본값 — matrix.ts 의 defaultAllowed 를 역할로 조회. 미지정 scopeKey 는 닫힘(false). */
export function roleDefaultAllowed(role: Role, scopeKey: string): boolean {
  const item = findPermItem(scopeKey);
  if (!item) return false;
  return item.defaultAllowed[ROLE_INDEX[role]];
}

/** 역할 기본값에 조직별 오버라이드를 얹는다. 오버라이드가 없으면 기본값 그대로. */
export function roleEffectiveAllowed(
  role: Role,
  scopeKey: string,
  overrides: readonly RoleOverride[],
): boolean {
  if (role === "owner") return true; // 불변
  const override = overrides.find((o) => o.role === role && o.scopeKey === scopeKey);
  if (override) return override.allowed;
  return roleDefaultAllowed(role, scopeKey);
}

/**
 * 최종 판정. 개인 예외가 있으면 역할값을 덮는다 — **차단이 허용을 이긴다**
 * (deny 와 allow 예외가 동시에 있는 잘못된 상태는 애초에 만들지 않는다: 예외는
 * (org, user, scopeKey) 단일 행이라 한쪽만 존재할 수 있다).
 */
export function resolveEffectivePermission(
  role: Role,
  scopeKey: string,
  overrides: readonly RoleOverride[],
  exceptions: readonly MemberException[],
  userId: string,
): boolean {
  if (role === "owner") return true;
  const roleAllowed = roleEffectiveAllowed(role, scopeKey, overrides);
  const exception = exceptions.find((e) => e.userId === userId && e.scopeKey === scopeKey);
  if (exception?.decision === "deny") return false;
  if (exception?.decision === "allow") return true;
  return roleAllowed;
}

export type PermAccess =
  | { kind: "allowed" }
  | { kind: "denied"; reason: "permission" };

/** 화면 게이트용 얇은 판정 — allowed 여부를 access 타입으로 감싼다. */
export function resolvePermAccess(allowed: boolean): PermAccess {
  return allowed ? { kind: "allowed" } : { kind: "denied", reason: "permission" };
}
