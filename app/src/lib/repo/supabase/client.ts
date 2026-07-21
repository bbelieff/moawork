import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase 클라이언트 팩토리 (T02 · B2).
 *
 * 비밀값은 저장소에 두지 않는다 — 전부 환경변수로만 주입한다(.env.example 참고).
 * 환경변수가 없으면 `null` 을 돌려주고, 소비 측은 로컬 소스로 폴백한다.
 * 덕분에 Supabase 연결 전에도 화면/서비스가 그대로 돌아간다.
 */

export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

/** 읽는 키가 둘뿐이라 ProcessEnv 전체가 아니라 느슨한 레코드를 받는다(테스트 주입 용이). */
export type EnvLike = Record<string, string | undefined>;

export function readSupabaseEnv(
  env: EnvLike = process.env,
): { url: string; anonKey: string } | null {
  const url = env[SUPABASE_URL_ENV]?.trim();
  const anonKey = env[SUPABASE_ANON_KEY_ENV]?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** 환경변수가 갖춰졌는지. 라우트/서비스가 폴백 여부를 판단할 때 쓴다. */
export function isSupabaseConfigured(
  env: EnvLike = process.env,
): boolean {
  return readSupabaseEnv(env) !== null;
}

let cached: SupabaseClient | null = null;

/**
 * 프로세스 단위 단일 클라이언트. 미설정이면 null.
 *
 * 주의: anon key + RLS 조합을 전제로 한다. service-role 키는 절대 쓰지 않는다
 * (조직 격리를 DB 가 강제해야 하므로 — RLS 소유는 T03).
 */
export function getSupabaseClient(
  env: EnvLike = process.env,
): SupabaseClient | null {
  if (cached) return cached;
  const conf = readSupabaseEnv(env);
  if (!conf) return null;
  cached = createClient(conf.url, conf.anonKey, {
    auth: { persistSession: false },
  });
  return cached;
}

/** 테스트용 — 캐시된 클라이언트를 비운다. */
export function resetSupabaseClient(): void {
  cached = null;
}
