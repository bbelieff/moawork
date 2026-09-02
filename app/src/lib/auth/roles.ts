// 조직 멤버 역할/담당범위의 위계·판정 로직. 타입/enum 자체는 lib/types 가 정본.
//   member_role  = owner > admin > team_lead > member
//   member_scope = all / department / assigned
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
  owner: 4,
  admin: 3,
  team_lead: 2,
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

/*
 * ── 화면에 보이는 이름 — «여기 하나» 가 정본이다 ──
 *
 * ★ 전에는 일곱 파일이 각자 이름표를 적어 뒀고, 같은 역할이 «네 이름» 으로 불렸다:
 *
 *     member  →  멤버(roles·perm) · 사원(account·privacy) · 담당(seats) · 구성원(조직관리·스위처)
 *     owner   →  소유자(roles·perm) · 대표(나머지 다섯)
 *
 *   그래서 한 사람이 조직관리 목록에서는 「구성원」, 자리 목록에서는 「담당」,
 *   권한표에서는 「멤버」로 보였다. 같은 화면 안에서도 갈래마다 달랐다.
 *
 * ★★ 그리고 그건 «불일치» 로 끝나지 않았다 — 개인정보 화면이 `admin` 을 **「팀장」** 이라고
 *   불렀다(settings/account/privacy). 관리자인 사람이 자기 화면에서 팀장으로 읽혔다.
 *   손으로 적은 지도는 어긋나기만 하는 게 아니라 «틀린다».
 *
 * 고르는 기준은 셋이었다 —
 *   ① 이미 제일 많이 쓰던 말을 따른다 (대표 5:2 · 관리자 6:1 · 팀장 7:0)
 *   ② «이미 다른 뜻으로 쓰는 말» 을 피한다 — 「담당」은 담당자·담당 보드로 이미 쓴다
 *   ③ 남의 말보다 우리 말 — 「멤버」 대신 「구성원」, 계급으로 읽히는 「사원」도 피한다
 */
const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "대표",
  admin: "관리자",
  team_lead: "팀장",
  member: "구성원",
};

const SCOPE_LABEL: Record<MemberScope, string> = {
  all: "회사 전체",
  department: "부서 이하 전체",
  assigned: "본인 담당분",
};

export function roleLabel(role: MemberRole): string {
  return ROLE_LABEL[role];
}

export function scopeLabel(scope: MemberScope): string {
  return SCOPE_LABEL[scope];
}

/**
 * 모르는 값까지 받아 «모른다» 고 말한다.
 *
 * ★ 화면은 역할을 못 읽는 경우가 있다(요약에서 빠진 사람 등). 그때 빈칸으로 두면
 *   「없음」으로 읽히고, 아무 역할이나 넣으면 «없는 사실을 단언» 하는 것이 된다.
 *   그래서 부르는 쪽마다 삼항을 적지 않게 여기서 한 번에 답한다.
 */
export function roleLabelOrUnknown(role: MemberRole | null | undefined): string {
  return role ? ROLE_LABEL[role] : "모름";
}
