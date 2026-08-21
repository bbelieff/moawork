// Supabase 접속 정보는 환경변수로만 주입한다(저장소에 비밀값 금지).
// NEXT_PUBLIC_ 접두사는 브라우저에 노출되므로 anon key 만 사용한다(서비스 롤 키 금지).

export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // 이 오류는 여러 서버 컴포넌트와 라우트의 공용 경계를 지난다. 설정 키나 로컬 파일 경로를
    // 응답 본문에 싣지 않는다. 구체적인 설정 진단은 서버 로그/배포 설정에서만 한다.
    throw new Error("서비스 연결 설정을 확인할 수 없습니다.");
  }
  return { url, anonKey };
}
