import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Ctx, MemberScope } from "@/lib/types";
import { isMemberRole } from "@/lib/auth/roles";
import { adminGrantFromFallback } from "@/lib/auth/admin";
import { getRepo } from "@/lib/repo";
import { SEED_ORG_ID } from "@/lib/repo/local/seed";

// 로컬 개발용 dev-session — Supabase Auth 연결 전까지 쿠키로 "누가 로그인했는지"를 표현한다.
// (연결 후에는 이 파일만 Supabase 세션 판독으로 교체; 소비 측 getSession() 계약은 유지.)
//   mw_uid : 로그인한 사용자 id
//   mw_org : 현재 조직 id(온보딩으로 조직 생성 시 갱신). 없으면 시드 조직.
//   mw_as  : (선택) 역할 오버라이드 — 개발 중 owner/admin/member 로 빠르게 전환.
// Next16 의 cookies() 는 비동기라 getSession 도 async 다.

export const SESSION_COOKIE = {
  uid: "mw_uid",
  org: "mw_org",
  as: "mw_as",
} as const;

export async function getSessionOrNull(): Promise<Ctx | null> {
  const jar = await cookies();
  const uid = jar.get(SESSION_COOKIE.uid)?.value;
  if (!uid) return null;

  const repo = getRepo();
  const user = repo.getUser(uid);
  if (!user) return null;

  const orgId = jar.get(SESSION_COOKIE.org)?.value ?? SEED_ORG_ID;
  const org = repo.getOrg(orgId);
  if (!org) return null;

  const membership = repo.listMembers(orgId).find((m) => m.user_id === uid);
  if (!membership) return null;

  // 4b) 관리자 자동부여 — 실DB 미연결 구간이라 폴백 allowlist 로 판정한다.
  // Supabase 연결 후에는 여기서 app_admin_role RPC 를 주입한다(resolveAdminGrant 2번째 인자).
  const grant = adminGrantFromFallback(user.email);

  return applyAs(
    {
      user,
      org,
      // 관리자 예약 사용자는 조직 내 역할이 낮게 잡혀 있어도 owner 로 승격한다.
      role: grant ? grant.role : membership.role,
      scope: grant ? "all" : membership.scope,
      isPlatformAdmin: grant?.isPlatform ?? false,
    },
    jar.get(SESSION_COOKIE.as)?.value,
  );
}

/** 세션 필수 컨텍스트. 없으면 /login 으로 리다이렉트(→ 반환은 항상 Ctx). */
export async function getSession(): Promise<Ctx> {
  const ctx = await getSessionOrNull();
  if (!ctx) redirect("/login");
  return ctx;
}

/**
 * 역할 오버라이드 적용(개발용 ?as= / mw_as 쿠키).
 * as='member' → scope='assigned'(본인 담당만), 그 외 → scope='all'.
 */
export function applyAs(ctx: Ctx, as: string | null | undefined): Ctx {
  if (!isMemberRole(as)) return ctx;
  const scope: MemberScope = as === "member" ? "assigned" : "all";
  return { ...ctx, role: as, scope };
}
