import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

// Next 16: `middleware` 는 `proxy` 로 대체됐다(node_modules/next/dist/docs — proxy.ts 규약).
// 역할:
//   1) 매 요청마다 Supabase 세션 토큰을 갱신(쿠키 재기록)한다. SSR 인증의 필수 절차.
//   2) 인증되지 않은 사용자를 /login 으로 보낸다. 앱 전체가 로그인 뒤에 있다.
//
// 공개 경로(미인증 허용): /login, /auth/*(OAuth 콜백/로그아웃).
// 그 외 모든 경로는 세션이 없으면 /login 으로 리다이렉트한다.
// 다른 트랙이 추가하는 앱 페이지는 이 계약에 따라 "인증된 사용자" 를 전제로 한다.

const PUBLIC_PATHS = ["/login", "/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname, search } = request.nextUrl;

  // Supabase 미설정(개발 초기 등)에는 인증 게이트를 끄고 통과시킨다.
  // 운영에서는 env 를 반드시 설정해야 게이트가 활성화된다.
  let env: { url: string; anonKey: string };
  try {
    env = getSupabaseEnv();
  } catch {
    if (process.env.NODE_ENV === "production" && !isPublicPath(pathname)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("error", "config");
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }
  const { url, anonKey } = env;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() 를 호출해 토큰을 검증·갱신한다(세션 유지의 핵심).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 미인증 + 비공개 경로 → 로그인으로.
  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // 정적 자산·이미지·파비콘은 제외하고 모든 경로에서 실행한다.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
