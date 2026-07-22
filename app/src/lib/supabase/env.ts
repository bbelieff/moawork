// Supabase 접속 정보는 환경변수로만 주입한다(저장소에 비밀값 금지).
// NEXT_PUBLIC_ 접두사는 브라우저에 노출되므로 anon key 만 사용한다(서비스 롤 키 금지).

export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase 환경변수 누락: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 를 설정하세요 (app/.env.local).",
    );
  }
  return { url, anonKey };
}
