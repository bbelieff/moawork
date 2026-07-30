import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { parseAdminRole } from "@/lib/auth/admin";
import {
  decideWorkspaceDestination,
  workspaceTargetFromNext,
} from "@/lib/auth/workspace-routing";

function loginError(request: Request, code: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
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

  const { data: membershipData, error: membershipError } = await supabase
    .from("org_members")
    .select(
      "org_id, status, role, scope, orgs!inner(id, slug, status, name, plan_tier, created_at)",
    )
    .eq("user_id", user.id);
  // 플랫폼 관리자 판정 — app_admins 는 RLS 로 직접 select 가 막혀 있어
  // SECURITY DEFINER 함수(app_admin_role)만이 유일한 조회 경로다(005).
  // 판정 실패는 "관리자 아님"으로 수렴한다 — 여기서 실패를 관리자로 처리하면
  // 조회 장애가 곧 권한 상승이 된다.
  let isPlatformAdmin = false;
  if (user.email) {
    try {
      // 응답 형태를 가정하지 않는다 — RPC 미지원·SDK 변경·목 환경에서 undefined 가 올 수 있고,
      // 그때 구조분해로 터지면 로그인 전체가 막힌다(판정 하나 때문에 인증을 잃지 않는다).
      const adminResult = await supabase.rpc("app_admin_role", {
        p_email: user.email,
      });
      if (adminResult && !adminResult.error) {
        isPlatformAdmin = parseAdminRole(adminResult.data) !== null;
      }
    } catch {
      // 판정 불가 → 관리자 아님으로 수렴.
    }
  }

  const decision = decideWorkspaceDestination(
    membershipError ? null : membershipData,
    workspaceTargetFromNext(url.searchParams.get("next")),
    isPlatformAdmin,
  );

  const response = NextResponse.redirect(new URL(decision.path, url.origin));
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
