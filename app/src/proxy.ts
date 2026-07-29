import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { safeNextPath } from "@/lib/auth/oauth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { decideWorkspaceNamespace, isWorkspaceNamespaceCandidate } from "@/lib/auth/workspace-namespace";
import { WORKSPACE_ENTRY_RESUME_COOKIE } from "@/lib/workspace-entry/contracts";

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
  const refreshedCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const aliasCandidate = pathname.match(/^\/([^/]+)$/)?.[1];
  const safeRequestedPath = safeNextPath(`${pathname}${search}`, "/");

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
      loginUrl.searchParams.set("next", safeRequestedPath);
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
        refreshedCookies.splice(0, refreshedCookies.length, ...cookiesToSet);
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
    const canonicalNext = aliasCandidate && isWorkspaceNamespaceCandidate(pathname)
      ? `/w/${aliasCandidate}${search}`
      : safeRequestedPath;
    loginUrl.search = "";
    loginUrl.searchParams.set("next", canonicalNext);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isWorkspaceNamespaceCandidate(pathname)) {
    const { data: membershipRows, error: membershipError } = await supabase
      .from("org_members")
      .select("org_id, status, role, scope, created_at, orgs!inner(id, slug, status, name, plan_tier, created_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    const decision = decideWorkspaceNamespace(`${pathname}${search}`, membershipError ? null : membershipRows);
    if (decision.kind === "deny" || decision.kind === "none") {
      const denied = request.nextUrl.clone();
      denied.pathname = "/workspace-entry";
      denied.search = "";
      denied.searchParams.set("error", "routing");
      const deniedResponse = NextResponse.redirect(denied);
      deniedResponse.cookies.delete(SESSION_COOKIE.org);
      return deniedResponse;
    }

    request.cookies.set(SESSION_COOKIE.org, decision.orgId);
    let namespaceResponse: NextResponse;
    if (decision.kind === "alias") {
      namespaceResponse = NextResponse.redirect(new URL(decision.canonical, request.url));
    } else {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("cookie", request.cookies.toString());
      namespaceResponse = NextResponse.rewrite(new URL(decision.internal, request.url), { request: { headers: requestHeaders } });
    }
    for (const cookie of refreshedCookies) namespaceResponse.cookies.set(cookie.name, cookie.value, cookie.options);
    namespaceResponse.cookies.set(SESSION_COOKIE.org, decision.orgId, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    namespaceResponse.cookies.delete(WORKSPACE_ENTRY_RESUME_COOKIE);
    return namespaceResponse;
  }

  return response;
}

export const config = {
  // 정적 자산·이미지·파비콘, 그리고 분석 프록시(/ingest/*)는 제외하고 모든 경로에서 실행한다.
  //
  // /ingest 를 빼는 이유 두 가지:
  //   1) 로그인 화면에서도 이벤트가 나가야 한다. 인증 게이트에 걸리면 미인증 구간이 통째로 빈다.
  //   2) 수집 요청마다 supabase.auth.getUser() 왕복이 붙으면 비콘 비용이 인증 비용이 된다.
  // 값은 `lib/analytics/config.ts` 의 ANALYTICS_PROXY_PATH 와 같아야 한다.
  // (Next 는 matcher 를 정적으로 읽으므로 상수를 끼워 넣을 수 없어 문자열로 둔다.)
  matcher: [
    // `ingest(?:/|$)` — 경계를 붙여 /ingestion 같은 앞으로의 경로가 게이트에서 새지 않게 한다.
    "/((?!_next/static|_next/image|favicon.ico|ingest(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
