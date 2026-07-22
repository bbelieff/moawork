import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  atLeast,
  isManager,
  isMemberRole,
  isMemberScope,
  type MemberRole,
  type MemberScope,
} from "./roles";

// 서버측 인증/인가 헬퍼. DB RLS(001_schema_v1.sql)가 1차 방어선이고, 이 함수들은
// 서버 라우트/액션에서 접근을 사전 차단(가드)하고 UI 를 분기하기 위한 2차 계층이다.
// 대상 테이블은 스키마 정본의 public.org_members (role: member_role, scope: member_scope).

export interface Membership {
  role: MemberRole;
  scope: MemberScope;
}

/** 현재 세션의 인증 사용자(없으면 null). getUser() 는 토큰을 서버에서 검증한다. */
export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** 현재 사용자의 특정 조직 내 멤버십(역할+범위). 멤버가 아니면 null. */
export async function getMyMembership(
  orgId: string,
): Promise<Membership | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("org_members")
    .select("role, scope")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data || !isMemberRole(data.role) || !isMemberScope(data.scope)) {
    return null;
  }
  return { role: data.role, scope: data.scope };
}

/** 현재 사용자의 해당 조직 내 역할(멤버가 아니면 null). */
export async function getMyRole(orgId: string): Promise<MemberRole | null> {
  return (await getMyMembership(orgId))?.role ?? null;
}

/**
 * 최소 min 이상의 역할을 요구한다. 미충족 시 예외.
 * 서버 라우트 핸들러/액션 진입부 가드로 사용한다.
 */
export async function requireRole(
  orgId: string,
  min: MemberRole,
): Promise<MemberRole> {
  const role = await getMyRole(orgId);
  if (!atLeast(role, min)) {
    throw new Error(`권한 부족: 조직 ${orgId} 에서 ${min} 이상 필요`);
  }
  // atLeast 가 true 면 role 은 non-null 이 보장된다.
  return role as MemberRole;
}

/** 관리 권한(owner/admin)을 요구한다. 미충족 시 예외. */
export async function requireManager(orgId: string): Promise<MemberRole> {
  const role = await getMyRole(orgId);
  if (!isManager(role)) {
    throw new Error(`권한 부족: 조직 ${orgId} 에서 관리자(owner/admin) 필요`);
  }
  return role as MemberRole;
}
