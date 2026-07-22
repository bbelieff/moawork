// 플랫폼 관리자 자동부여 — 디스패치 B1 §4b, 스키마 005_app_admins.sql.
//
// 규약: 로그인 성공 시 서버에서 `select public.app_admin_role(<email>)` 를 호출하고,
//       결과가 non-null 이면 그 사용자를 owner + 플랫폼 관리자로 승격한다.
//       (app_admins 테이블은 RLS 로 직접 조회가 막혀 있고, SECURITY DEFINER 함수로만 읽는다.)
//
// 실DB 미연결 구간에서도 같은 판정이 나오도록 dev-session 폴백 allowlist 를 둔다.
// 폴백 목록은 005 의 seed 와 **같은 값**이어야 한다 — 한쪽만 바꾸지 말 것.
// 이메일은 비밀값이 아니므로(공개 식별자) 저장소에 두어도 규약 위반이 아니다.

import type { MemberRole } from "@/lib/types";
import { isMemberRole } from "@/lib/auth/roles";

/** 005_app_admins.sql 의 예약 seed 와 동일. dev-session 폴백 전용. */
export const PLATFORM_ADMIN_FALLBACK: ReadonlyArray<{
  email: string;
  role: MemberRole;
  is_platform: boolean;
}> = [{ email: "beliefkimkim@gmail.com", role: "owner", is_platform: true }];

export type AdminGrant = {
  role: MemberRole;
  isPlatform: boolean;
};

/** 이메일 정규화 — 005 의 `where email = lower(p_email)` 와 동일 규칙. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const v = email.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

/**
 * 폴백 allowlist 판정(순수 함수).
 * 실DB 가 붙으면 app_admin_role() 결과가 우선하고, 이 함수는 미연결 구간 전용이다.
 */
export function adminGrantFromFallback(
  email: string | null | undefined,
): AdminGrant | null {
  const key = normalizeEmail(email);
  if (!key) return null;
  const hit = PLATFORM_ADMIN_FALLBACK.find((a) => a.email === key);
  return hit ? { role: hit.role, isPlatform: hit.is_platform } : null;
}

/** app_admin_role() 이 돌려준 임의 값을 MemberRole 로 좁힌다. 알 수 없는 값은 무시(null). */
export function parseAdminRole(value: unknown): MemberRole | null {
  return isMemberRole(value) ? value : null;
}

/**
 * 관리자 판정 — 실DB(app_admin_role RPC)가 있으면 그것을, 없으면 폴백을 쓴다.
 *
 * rpc 는 주입식으로 받아 이 모듈이 Supabase 클라이언트에 직접 의존하지 않게 한다
 * (테스트 용이 + 미연결 구간 빌드 가능). 호출부는 Supabase 세션 확보 후
 * `(email) => supabase.rpc("app_admin_role", { p_email: email })` 를 넘기면 된다.
 *
 * RPC 가 실패하면(네트워크·권한) 폴백으로 내려간다 — 로그인 자체를 막지 않기 위함.
 */
export async function resolveAdminGrant(
  email: string | null | undefined,
  rpc?: (email: string) => Promise<unknown>,
): Promise<AdminGrant | null> {
  const key = normalizeEmail(email);
  if (!key) return null;

  if (rpc) {
    try {
      const role = parseAdminRole(await rpc(key));
      // non-null 이면 관리자. 005 는 is_platform 을 별도 컬럼으로 갖지만
      // app_admin_role() 은 role 만 돌려주므로, 승격된 사용자는 플랫폼 관리자로 본다.
      if (role) return { role, isPlatform: true };
      // RPC 가 명시적으로 "관리자 아님"을 답했으면 폴백으로 뒤집지 않는다.
      return null;
    } catch {
      // 조회 실패는 판정 불가 — 폴백으로 내려간다.
    }
  }

  return adminGrantFromFallback(key);
}
