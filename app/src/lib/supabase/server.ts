import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

// 서버 컴포넌트 / 라우트 핸들러 / 서버 액션용 Supabase 클라이언트.
// Next 16 에서 cookies() 는 비동기이므로 await 후 어댑터에 연결한다.
export async function createClient(options: { noStore?: boolean } = {}) {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    global: options.noStore ? {
      fetch(input, init) {
        return fetch(input, { ...init, cache: "no-store" });
      },
    } : undefined,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없다.
          // 세션 갱신은 proxy 가 담당하므로 여기서는 무시해도 안전하다.
        }
      },
    },
  });
}
