import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/oauth";
import { parseAdminRole } from "@/lib/auth/admin";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { bootstrapWorkspace } from "@/lib/workspace/service";

type MembershipRow = { org_id: string; role: unknown };

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

  const { data: adminRole, error: adminError } = user.email
    ? await supabase.rpc("app_admin_role", { p_email: user.email })
    : { data: null, error: null };
  if (adminError) return loginError(request, "provisioning");
  const platformRole = parseAdminRole(adminRole);

  const { data: membershipData, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id);
  if (membershipError) return loginError(request, "provisioning");

  const memberships = (membershipData ?? []) as MembershipRow[];
  const ownerMembership = memberships.find(
    (membership) => membership.role === "owner",
  );
  const selectedMembership = platformRole
    ? ownerMembership
    : (ownerMembership ?? memberships[0]);
  let orgId = selectedMembership?.org_id;
  let isNewOwnerOrg = false;

  // 플랫폼 관리자는 자기 소유 조직이 반드시 있어야 한다. org insert 뒤의
  // 001.trg_orgs_add_owner가 SECURITY DEFINER로 owner 멤버십을 원자적으로 만든다.
  //
  // insert().select()는 INSERT의 RETURNING 행에도 orgs_select RLS를 적용한다.
  // owner 멤버십은 AFTER INSERT 트리거에서 생기므로 RETURNING 시점에는 아직
  // select 정책을 통과하지 못한다. ID를 먼저 만들고 return=minimal로 삽입해
  // RLS를 약화하지 않은 채 이 실행 순서 충돌을 피한다.
  if (platformRole && !orgId) {
    const newOrgId = randomUUID();
    const { error: orgError } = await supabase
      .from("orgs")
      .insert({ id: newOrgId, name: "MoaWork 데모 조직" });
    if (orgError) return loginError(request, "provisioning");
    orgId = newOrgId;
    isNewOwnerOrg = true;
  }

  if (!orgId) return loginError(request, "membership");

  // owner만 DB SECURITY DEFINER bootstrap 진입점을 호출한다.
  // 일반 member/admin 로그인은 기존 조직을 변경하지 않는다.
  if (isNewOwnerOrg || selectedMembership?.role === "owner") {
    try {
      await bootstrapWorkspace(supabase, orgId);
    } catch {
      return loginError(request, "provisioning");
    }
  }

  const destination = new URL(
    isNewOwnerOrg
      ? "/onboarding?first=1"
      : safeNextPath(url.searchParams.get("next")),
    url.origin,
  );
  const response = NextResponse.redirect(destination);
  response.cookies.set(SESSION_COOKIE.org, orgId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  response.cookies.delete(SESSION_COOKIE.uid);
  response.cookies.delete(SESSION_COOKIE.as);
  return response;
}
