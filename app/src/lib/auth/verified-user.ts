/**
 * 로그인한 사람을 토큰 서명으로 확인한다 (Issue 857).
 *
 * 전에는 요청마다 auth.getUser() 로 인증 서버에 물었다 — 프록시·세션·라우팅이 각각 한 번씩,
 * 서버(쿠알라룸푸르)↔Supabase 왕복 한 번에 0.1초씩. getClaims() 는 이 프로젝트의 서명 키가
 * 비대칭이면 공개키(프로세스 안 10분 캐시)로 그 자리에서 확인하고, 대칭 키면 supabase-js 가
 * 스스로 getUser 로 확인한다. 만료된 토큰은 먼저 갱신된다(getUser 와 같다).
 * 데이터 접근은 같은 토큰으로 RLS 가 다시 판정한다.
 *
 * 차이 하나: getUser 는 매번 인증 서버에서 세션이 살아 있는지 봤다. 서명 확인은 다른 기기에서
 * 로그아웃·관리자 폐기된 세션의 access token 도 만료(exp, 기본 1시간)까지 통과시킨다. 데이터 API
 * (PostgREST)도 같은 토큰을 서명·만료로만 받으므로 그 기간에 열리는 범위는 늘지 않는다. 회사
 * 멤버십·권한은 요청마다 DB 에서 다시 읽는다.
 *
 * 확인 중 예상 밖 예외(깨진 토큰의 JSON, 지원 안 하는 서명 방식 등)는 «로그인 안 함» 으로 닫는다 —
 * 전에는 인증 서버가 거절해 null 이었고, 그대로 던지면 그 요청이 500 이 된다.
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
  let result: Awaited<ReturnType<ClaimsAuthClient["auth"]["getClaims"]>>;
  try {
    result = await client.auth.getClaims();
  } catch {
    return null;
  }
  const { data, error } = result;
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
