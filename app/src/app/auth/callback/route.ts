import { relativeRedirect } from "@/lib/auth/relative-redirect";
import { createClient } from "@/lib/supabase/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import {
  decideWorkspaceDestination,
  workspaceTargetFromNext,
} from "@/lib/auth/workspace-routing";
import { sanitizeModeNext } from "@/lib/mode/contract";
import { modePreferenceCookie } from "@/lib/mode/preference";
import { joinTargetFromNext } from "@/lib/org/invite-links";

function loginError(request: Request, code: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", code);
  return relativeRedirect(url.pathname + url.search);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return loginError(request, "auth");

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return loginError(request, "auth");

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return loginError(request, "auth");

  const metadata = user.user_metadata ?? {};
  // The profile write and the platform guard are independent once the user is
  // known, so they are issued together (one serial step, not two). Precedence
  // is unchanged: a profile failure still wins over any platform/membership
  // routing below, and the admin RPC still fails closed (never grants).
  // The membership read stays lazy so a verified platform admin never pays
  // for — or leaves traces of — a tenant read they do not need.
  const [profileResult, adminResult] = await Promise.all([
    supabase.from("users").upsert(
      {
        id: user.id,
        email: user.email ?? null,
        name: metadata.full_name ?? metadata.name ?? null,
        avatar_url: metadata.avatar_url ?? metadata.picture ?? null,
      },
      { onConflict: "id" },
    ),
    (async () => {
      try {
        return await supabase.rpc("is_platform_admin");
      } catch {
        // Preserve ordinary verified membership routing when the guard is unavailable.
        return { data: false as const, error: { message: "unavailable" } };
      }
    })(),
  ]);
  const { error: profileError } = profileResult;
  if (profileError) return loginError(request, "profile");

  // The SECURITY DEFINER RPC binds the platform decision to auth.uid().
  // A false, malformed, or unavailable result never grants the platform plane.
  const isPlatformAdmin =
    !adminResult.error && adminResult.data === true;

  if (isPlatformAdmin) {
    const destination = new URL("/mode", url.origin);
    const next = sanitizeModeNext(url.searchParams.get("next"));
    if (next) destination.searchParams.set("next", next);
    const response = relativeRedirect(destination.pathname + destination.search);
    // A fresh OAuth login must not silently reuse an earlier mode preference.
    response.cookies.delete(modePreferenceCookie.name);
    response.cookies.delete(SESSION_COOKIE.org);
    response.cookies.delete(SESSION_COOKIE.uid);
    response.cookies.delete(SESSION_COOKIE.as);
    return response;
  }

  /*
   * ★ 초대 링크로 온 사람은 «그 링크로» 돌려보낸다 (#722).
   *
   *   링크를 누른 사람은 아직 어느 회사 사람도 아니다. 그래서 평소 길로 보내면
   *   소속 0 판정을 받아 「신청하세요」 화면에 떨어지고, 초대받은 줄도 모른 채
   *   회사 주소를 손으로 찾게 된다 — 링크로 부르는 이유가 그대로 사라진다.
   *
   *   ★ joinTargetFromNext 가 «모양까지» 잰다. /join/<토큰> 하나만 통과하고
   *     다른 사이트·다른 화면·경로 거슬러 오르기는 전부 null 이 된다(열린 리다이렉트 방지).
   *     그래서 여기서 다시 검사하지 않는다 — 두 군데서 검사하면 언젠가 갈라진다.
   *
   *   회사 쿠키는 «심지 않는다». 아직 들어간 것이 아니고, 들어가는 것은 그 화면의 일이다.
   */
  const joinTarget = joinTargetFromNext(url.searchParams.get("next"));
  if (joinTarget) {
    // relativeRedirect — 프록시 뒤에서도 브라우저 오리진을 지킨다(main 의 기존 방식).
    const response = relativeRedirect(joinTarget);
    response.cookies.delete(SESSION_COOKIE.org);
    response.cookies.delete(SESSION_COOKIE.uid);
    response.cookies.delete(SESSION_COOKIE.as);
    return response;
  }

  const { data: membershipData, error: membershipError } = await supabase
    .from("org_members")
    .select(
      "org_id, status, role, scope, orgs!inner(id, slug, status, name, plan_tier, created_at)",
    )
    .eq("user_id", user.id);
  const decision = decideWorkspaceDestination(
    membershipError ? null : membershipData,
    workspaceTargetFromNext(url.searchParams.get("next")),
  );

  const response = relativeRedirect(decision.path);
  if (decision.kind === "workspace") {
    response.cookies.set(SESSION_COOKIE.org, decision.orgId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  } else {
    response.cookies.delete(SESSION_COOKIE.org);
  }
  response.cookies.delete(SESSION_COOKIE.uid);
  response.cookies.delete(SESSION_COOKIE.as);
  return response;
}
