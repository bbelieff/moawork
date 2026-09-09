import { relativeRedirect } from "@/lib/auth/relative-redirect";
import { createClient } from "@/lib/supabase/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import {
  decideWorkspaceDestination,
  workspaceTargetFromNext,
} from "@/lib/auth/workspace-routing";
import { sanitizeModeNext } from "@/lib/mode/contract";
import { modePreferenceCookie } from "@/lib/mode/preference";

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
  const { error: profileError } = await supabase.from("users").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      name: metadata.full_name ?? metadata.name ?? null,
      avatar_url: metadata.avatar_url ?? metadata.picture ?? null,
    },
    { onConflict: "id" },
  );
  if (profileError) return loginError(request, "profile");

  // The SECURITY DEFINER RPC binds the platform decision to auth.uid().
  // A false, malformed, or unavailable result never grants the platform plane.
  let isPlatformAdmin = false;
  try {
    const adminResult = await supabase.rpc("is_platform_admin");
    isPlatformAdmin = !adminResult.error && adminResult.data === true;
  } catch {
    // Preserve ordinary verified membership routing when the guard is unavailable.
  }

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
