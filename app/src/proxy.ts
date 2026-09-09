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
// 공개 경로(미인증 허용): /login, /auth/*(OAuth 콜백/로그아웃), exact health probes.
// 그 외 모든 경로는 세션이 없으면 /login 으로 리다이렉트한다.
// 다른 트랙이 추가하는 앱 페이지는 이 계약에 따라 "인증된 사용자" 를 전제로 한다.
//
// ★ BBE-200 — 세션 유지의 구조 규약 (깨뜨리지 마라)
//   Supabase 는 refresh token 을 «회전» 시킨다. 갱신이 일어나는 순간 옛 토큰은
//   서버에서 폐기되므로, 그 요청의 «응답» 이 새 쿠키를 싣지 못하면 브라우저에는
//   이미 죽은 쿠키만 남는다. 다음 요청의 getUser() 가 실패해 사용자는
//   «가만히 있었는데 로그아웃됐다» 를 겪는다. 서버 컴포넌트는 쿠키를 쓸 수 없으므로
//   (lib/supabase/server.ts:21-24) proxy 가 «유일한 갱신 지점» 이다.
//
//   그래서 이 파일은 분기마다 쿠키를 손으로 복사하지 않는다. 우회를 «테스트로 세는»
//   대신 «타입 + 테스트로» 막는다:
//
//     routeRequest()  라우팅 «판단» 만 한다. 반환형이 RouteDecision 이라
//                     응답 객체를 만들 수도, 돌려줄 수도 없다 (tsc 가 막는다).
//     buildResponse() 응답을 만드는 유일한 곳. 갱신 세션 쿠키를 여기서 싣는다.
//
//   ★ 방어의 «정체» 를 정확히 알아둬라 — 타입만으로는 충분하지 않다.
//     DC-12 가 세 방향으로 뚫어본 실측:
//       · routeRequest 가 NextResponse 를 return       → tsc 가 막는다 (TS2322)
//       · `as any` 로 우회                              → eslint + 테스트 2건이 막는다
//       · proxy() 가 buildResponse 를 건너뛰고 «새 출구»  → 타입은 못 막는다.
//                                                        테스트 11건이 막는다
//     세 번째가 진짜 회귀 모양이다(「새 출구가 생긴다」). 그러니 이 파일의 테스트를
//     지우면 방어가 사라진다. 「타입이 막으니 안전하다」고 믿지 마라.

const PUBLIC_PATHS = ["/login", "/auth"];
const PUBLIC_HEALTH_PATHS = new Set([
  "/api/health/live",
  "/api/health/ready",
]);
const WORKSPACE_SLUG_COOKIE = "mw_workspace_slug";
const WORKSPACE_PROTECTED_ROOTS = new Set([
  "boards", "notices", "companies", "contract", "newcust", "work",
  "presets", "dash", "deals", "settlements", "onboarding", "settings",
]);

type RefreshedCookie = { name: string; value: string; options: Record<string, unknown> };

// 손으로 쓰는 워크스페이스 쿠키의 옵션. ★ Record<string, unknown> 로 두지 마라 —
// 그러면 `sameSite: "Lax"`(대문자)나 `httponly` 같은 오타가 «조용히 무시된다».
// 쿠키 보안 속성이 소리 없이 빠지는 유형이라, 구체 타입으로 좁혀 tsc 가 잡게 한다.
// (갱신 세션 쿠키 쪽은 @supabase/ssr 이 «만들어» 주므로 오타 위험이 없다.)
type WorkspaceCookieOptions = {
  path: string;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
};

/** 라우팅이 응답에 요구하는 쿠키 조작(세션 갱신 쿠키와는 별개다). */
type CookieOp =
  | { op: "set"; name: string; value: string; options: WorkspaceCookieOptions }
  | { op: "delete"; name: string };

/** 응답 «판단». 응답 «객체» 가 아니다 — 그래서 우회 return 이 만들어지지 않는다. */
type RouteDecision =
  | { kind: "pass"; cookies?: CookieOp[] }
  | { kind: "redirect"; to: Parameters<typeof NextResponse.redirect>[0]; cookies?: CookieOp[] }
  | {
      kind: "rewrite";
      to: Parameters<typeof NextResponse.rewrite>[0];
      requestHeaders: Headers;
      cookies?: CookieOp[];
    };

function workspaceCookieOptions(): WorkspaceCookieOptions {
  return { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" };
}

// 갱신 쿠키 보관함.
// ★ 이름 단위 upsert 다. @supabase/ssr 은 큰 토큰을 여러 청크 쿠키로 쪼개 쓰며
//   한 요청에서 setAll 을 두 번 이상 부를 수 있다. 배열을 통째로 치환하면
//   (이전 구현의 splice) 첫 배치의 Set-Cookie 가 통째로 사라진다.
// ★ 「빈 값 + maxAge 0」 삭제 지시도 갱신 쿠키의 한 종류다. 값을 «되살리지» 않고
//   ssr 이 준 것을 그대로 싣는다 — 그래야 로그아웃이 되살아나지 않는다.
function createRefreshedCookieJar() {
  const pending = new Map<string, RefreshedCookie>();
  return {
    upsert(cookies: RefreshedCookie[]) {
      for (const cookie of cookies) pending.set(cookie.name, cookie);
    },
    applyTo(response: NextResponse) {
      for (const cookie of pending.values()) {
        response.cookies.set(cookie.name, cookie.value, cookie.options);
      }
    },
  };
}

function protectedWorkspacePath(pathname: string): boolean {
  const first = pathname.split("/").filter(Boolean)[0];
  return first ? WORKSPACE_PROTECTED_ROOTS.has(first) : false;
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_HEALTH_PATHS.has(pathname) ||
    PUBLIC_PATHS.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  );
}

async function routeRequest(
  request: NextRequest,
  jar: ReturnType<typeof createRefreshedCookieJar>,
): Promise<RouteDecision> {
  const { pathname, search } = request.nextUrl;
  const aliasCandidate = pathname.match(/^\/([^/]+)$/)?.[1];
  const safeRequestedPath = safeNextPath(`${pathname}${search}`, "/");

  // Health must measure this process only. It must not depend on Supabase auth
  // refresh, and only the two exact allowlisted routes bypass the auth client.
  if (PUBLIC_HEALTH_PATHS.has(pathname)) return { kind: "pass" };

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
      return { kind: "redirect", to: loginUrl };
    }
    return { kind: "pass" };
  }
  const { url, anonKey } = env;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // 갱신된 값은 «이 요청» 에도 즉시 반영한다 — rewrite 대상 서버 컴포넌트가
        // 옛 쿠키를 읽지 않게 하기 위함(아래 requestHeaders 가 이것을 실어 보낸다).
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        jar.upsert(cookiesToSet as RefreshedCookie[]);
      },
    },
  });

  // getUser() 를 호출해 토큰을 검증·갱신한다(세션 유지의 핵심).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 미인증 + 비공개 경로 → 로그인으로.
  // ★ 이 응답도 갱신 쿠키를 실어야 한다. refresh 실패 시 @supabase/ssr 은
  //   «빈 값 + maxAge 0» 삭제 지시를 setAll 로 내리는데, 그걸 버리면 브라우저에
  //   무효 쿠키가 남아 재로그인까지 오염된다.
  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    const canonicalNext = aliasCandidate && isWorkspaceNamespaceCandidate(pathname)
      ? `/w/${aliasCandidate}${search}`
      : safeRequestedPath;
    loginUrl.search = "";
    loginUrl.searchParams.set("next", canonicalNext);
    return { kind: "redirect", to: loginUrl };
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
      return { kind: "redirect", to: denied, cookies: [{ op: "delete", name: SESSION_COOKIE.org }] };
    }

    request.cookies.set(SESSION_COOKIE.org, decision.orgId);
    const verifiedSlug = decision.canonical.match(/^\/w\/([^/?]+)/)?.[1];
    const cookies: CookieOp[] = [
      { op: "set", name: SESSION_COOKIE.org, value: decision.orgId, options: workspaceCookieOptions() },
      ...(verifiedSlug ? [{ op: "set" as const, name: WORKSPACE_SLUG_COOKIE, value: verifiedSlug, options: workspaceCookieOptions() }] : []),
      { op: "delete", name: WORKSPACE_ENTRY_RESUME_COOKIE },
    ];
    if (decision.kind === "alias") {
      return { kind: "redirect", to: new URL(decision.canonical, request.url), cookies };
    }
    // rewrite 대상 요청이 갱신된 쿠키를 들고 가게 한다.
    // ★ 실제로 그 일을 하는 줄은 여기가 아니라 위 setAll 의 `request.cookies.set()` 이다.
    //   (DC-12 가 아래 두 줄을 지우고 헤더를 바이트 단위로 비교했더니 동일했다.)
    //   아래 두 줄은 무해한 이중 방어로 남긴다 — 지워도 오늘은 같지만, 갱신 값이
    //   요청에 실리는 경로를 명시적으로 두는 쪽이 읽는 사람에게 안전하다.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("cookie", request.cookies.toString());
    return { kind: "rewrite", to: new URL(decision.internal, request.url), requestHeaders, cookies };
  }

  // Old product consumers may still emit an internal root-relative URL. Once
  // a workspace has been verified, never render that URL outside its tenant
  // namespace: canonicalize it before the protected route executes.
  if (user && protectedWorkspacePath(pathname)) {
    const slug = request.cookies.get(WORKSPACE_SLUG_COOKIE)?.value;
    if (slug && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
      const canonical = request.nextUrl.clone();
      canonical.pathname = `/w/${slug}${pathname}`;
      return { kind: "redirect", to: canonical };
    }
    const denied = request.nextUrl.clone();
    denied.pathname = "/workspace-entry";
    denied.search = "";
    denied.searchParams.set("error", "routing");
    return { kind: "redirect", to: denied };
  }

  return { kind: "pass" };
}

// ★ 응답을 만드는 유일한 곳. routeRequest 의 어느 분기에서 나온 판단이든
//   반드시 여기를 물리적으로 통과하므로, 갱신 세션 쿠키를 못 싣는 경로가 없다.
function buildResponse(request: NextRequest, decision: RouteDecision, jar: ReturnType<typeof createRefreshedCookieJar>): NextResponse {
  const response =
    decision.kind === "redirect"
      ? NextResponse.redirect(decision.to)
      : decision.kind === "rewrite"
        ? NextResponse.rewrite(decision.to, { request: { headers: decision.requestHeaders } })
        : NextResponse.next({ request });

  // 세션 갱신 쿠키가 먼저, 라우팅이 요구한 쿠키 조작이 그 위에.
  //
  // ★ 순서를 뒤집지 마라. 다만 «오늘의 이름 공간에서는 실재하는 충돌 사례가 없다» —
  //   라우팅 쿠키는 전부 `mw_*` 이고 갱신 세션 쿠키는 `sb-*-auth-token[.N]` 이라
  //   이름이 겹칠 수가 없다. 이건 앞으로 겹치게 될 때를 위한 방어이고,
  //   그때는 라우팅 의도가 이겨야 한다(예: 접근 거부 응답의 삭제 지시).
  //   ※ 없는 충돌 사례를 찾다가 이 규칙을 지우지 마라. 지금 안 겹치는 게 맞다.
  jar.applyTo(response);
  for (const cookie of decision.cookies ?? []) {
    if (cookie.op === "delete") response.cookies.delete(cookie.name);
    else response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const jar = createRefreshedCookieJar();
  const decision = await routeRequest(request, jar);
  if (decision.kind === "rewrite") {
    const requestHeaders = new Headers(decision.requestHeaders);
    // BBE-222: this is a trusted path hint only. Strip any caller-supplied
    // value, then derive it after authentication and namespace verification.
    requestHeaders.delete("x-mw-app-tab");
    if (/^\/w\/[^/]+\/(?:newcust|contract|work|companies|notices|presets)(?:\/|$)/.test(request.nextUrl.pathname)) {
      requestHeaders.set("x-mw-app-tab", "1");
    }
    return buildResponse(request, { ...decision, requestHeaders }, jar);
  }
  return buildResponse(request, decision, jar);
}

export const config = {
  // 정적 자산·이미지·파비콘, 그리고 분석 프록시(/mw-sig/*)는 제외하고 모든 경로에서 실행한다.
  //
  // /mw-sig 를 빼는 이유 두 가지:
  //   1) 로그인 화면에서도 이벤트가 나가야 한다. 인증 게이트에 걸리면 미인증 구간이 통째로 빈다.
  //   2) 수집 요청마다 supabase.auth.getUser() 왕복이 붙으면 비콘 비용이 인증 비용이 된다.
  // 값은 `lib/analytics/config.ts` 의 ANALYTICS_PROXY_PATH 와 같아야 한다.
  // (Next 는 matcher 를 정적으로 읽으므로 상수를 끼워 넣을 수 없어 문자열로 둔다.
  //  둘이 어긋나면 proxy.test.ts 가 빨간불로 잡는다.)
  matcher: [
    // `mw-sig(?:/|$)` — 경계를 붙여 /mw-signal 같은 앞으로의 경로가 게이트에서 새지 않게 한다.
    "/((?!_next/static|_next/image|favicon.ico|mw-sig(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
