// 조직 멤버 역할/담당범위의 위계·판정 로직. 타입/enum 자체는 lib/types 가 정본.
//   member_role  = owner > admin > member   ← 관리 권한 위계
//   member_scope = all / assigned           ← 데이터 열람 범위(전체 / 내 담당만)
// (viewer 역할은 스키마에 없다. 권한 축소는 scope='assigned' 로 표현한다.)
// 순수 함수만 담아 서버/클라이언트 공용 + 단위테스트가 쉽도록 한다.

import {
  MEMBER_ROLES,
  MEMBER_SCOPES,
  type MemberRole,
  type MemberScope,
} from "@/lib/types";

export { MEMBER_ROLES, MEMBER_SCOPES };
export type { MemberRole, MemberScope };

// 높을수록 강한 권한. 001_schema_v1.sql 의 org_role() 사용 패턴과 정합.
const ROLE_RANK: Record<MemberRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/** 역할의 위계 랭크. 멤버가 아니면(null/undefined) 0. */
export function roleRank(role: MemberRole | null | undefined): number {
  return role ? ROLE_RANK[role] : 0;
}

/** role 이 최소 min 이상의 권한을 갖는가. */
export function atLeast(
  role: MemberRole | null | undefined,
  min: MemberRole,
): boolean {
  return roleRank(role) >= roleRank(min);
}

/**
 * 관리 권한(owner/admin) 여부.
 * 001_schema_v1.sql 의 RLS 에서 반복되는 `org_role(org) in ('owner','admin')` 를 그대로 반영.
 */
export function isManager(role: MemberRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** 임의 값이 유효한 MemberRole 인지 좁힌다(DB/쿠키 값 검증용). */
export function isMemberRole(value: unknown): value is MemberRole {
  return (
    typeof value === "string" &&
    (MEMBER_ROLES as readonly string[]).includes(value)
  );
}

/** 임의 값이 유효한 MemberScope 인지 좁힌다. */
export function isMemberScope(value: unknown): value is MemberScope {
  return (
    typeof value === "string" &&
    (MEMBER_SCOPES as readonly string[]).includes(value)
  );
}

// ── 표시 라벨(UI 공용) — 목업 v0.3 사이드바 "소유자 · 전체 보기" 표기 기준 ──
const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "소유자",
  admin: "관리자",
  member: "멤버",
};

const SCOPE_LABEL: Record<MemberScope, string> = {
  all: "전체 보기",
  assigned: "내 담당만",
};

export function roleLabel(role: MemberRole): string {
  return ROLE_LABEL[role];
}

export function scopeLabel(scope: MemberScope): string {
  return SCOPE_LABEL[scope];
}
