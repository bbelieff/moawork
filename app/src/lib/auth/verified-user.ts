/**
 * 로그인한 사람을 토큰 서명으로 확인한다 (Issue 857).
 *
 * 전에는 요청마다 auth.getUser() 로 인증 서버에 물었다 — 프록시·세션·라우팅이 각각 한 번씩,
 * 서버(쿠알라룸푸르)↔Supabase 왕복 한 번에 0.1초씩. getClaims() 는 이 프로젝트의 서명 키가
 * 비대칭이면 공개키(프로세스 안 10분 캐시)로 그 자리에서 확인하고, 대칭 키면 supabase-js 가
 * 스스로 getUser 로 확인한다. 만료된 토큰은 먼저 갱신된다(getUser 와 같다).
 * 데이터 접근은 같은 토큰으로 RLS 가 다시 판정한다.
 */
export type VerifiedAuthUser = {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
};

export type ClaimsAuthClient = {
  auth: {
    getClaims(): Promise<{ data: { claims: object } | null; error: unknown }>;
  };
};

export async function getVerifiedAuthUser(client: ClaimsAuthClient): Promise<VerifiedAuthUser | null> {
  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (error || !claims || typeof claims.sub !== "string" || claims.sub === "") return null;
  const metadata = claims.user_metadata;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" && claims.email !== "" ? claims.email : null,
    user_metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {},
  };
}
