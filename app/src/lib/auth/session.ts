import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Ctx, Org, User } from "@/lib/types";
import { isMemberRole, isMemberScope } from "@/lib/auth/roles";
import { parseAdminRole } from "@/lib/auth/admin";
import {
  chooseSessionMembership,
  parseActiveMembershipRows,
} from "@/lib/auth/workspace-routing";
import { getRepo } from "@/lib/repo";
import { SEED_ORG_ID } from "@/lib/repo/local/seed";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedAuthUser } from "@/lib/auth/verified-user";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export const SESSION_COOKIE = {
  uid: "mw_uid",
  org: "mw_org",
  as: "mw_as",
} as const;

type MembershipRow = {
  org_id: unknown;
  status: unknown;
  role: unknown;
  scope: unknown;
  orgs: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseOrg(value: unknown): Org | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return null;
  const row = candidate as Record<string, unknown>;
  const id = text(row.id);
  const name = text(row.name);
  const planTier = text(row.plan_tier);
  const createdAt = text(row.created_at);
  return id && name && planTier && createdAt
    ? { id, name, plan_tier: planTier, created_at: createdAt }
    : null;
}

function parseMembership(row: MembershipRow | null) {
  const org = row ? parseOrg(row.orgs) : null;
  if (!row || !org || !isMemberRole(row.role) || !isMemberScope(row.scope)) {
    return null;
  }
  return { org, role: row.role, scope: row.scope };
}

// When no session is selected, «chooser» means the verified user still has
// active workspaces but none was picked (no or stale mw_org cookie with two or
// more memberships). That user belongs on the workspace chooser, not on the
// membership error. It never grants anything: the chooser re-reads membership.
type SupabaseSessionResult = { ctx: Ctx | null; chooser: boolean };

async function getSupabaseSession(
  preferredOrgId: string | undefined,
): Promise<Ctx | null> {
  return (await resolveSupabaseSession(preferredOrgId)).ctx;
}

async function resolveSupabaseSession(
  preferredOrgId: string | undefined,
): Promise<SupabaseSessionResult> {
  const denied = { ctx: null, chooser: false };
  const supabase = await createClient();
  // Issue 857 — 서명으로 확인(비대칭 키면 왕복 없음). 세션이 화면·액션마다 인증 서버에 묻던 0.1초.
  const authUser = await getVerifiedAuthUser(supabase);
  if (!authUser) return denied;
  const authUserId = authUser.id;

  // The tenant membership read and the platform identity read are independent
  // once the user is known, so they are issued together (one serial step, not
  // two). Denial is unchanged: a failed or non-selecting membership still
  // yields no session even when the platform read grants, and platform
  // identity never substitutes for tenant role/scope below.
  const membershipPromise = supabase
    .from("org_members")
    .select(
      "org_id, status, role, scope, orgs!inner(id, slug, status, name, plan_tier, created_at)",
    )
    .eq("user_id", authUserId)
    .order("created_at", { ascending: true });
  const platformRolePromise = authUser.email
    ? supabase
        .rpc("app_admin_role", { p_email: authUser.email })
        .then(
          (result) => result,
          () => ({ data: null, error: { message: "unavailable" } }),
        )
    : Promise.resolve(null);
  const [membershipResult, platformRoleResult] =
    await Promise.all([membershipPromise, platformRolePromise]);
  const { data: membershipRows, error: membershipError } = membershipResult;
  if (membershipError) return denied;

  const selected = chooseSessionMembership(membershipRows, preferredOrgId);
  if (!selected) {
    const parsed = parseActiveMembershipRows(membershipRows);
    return {
      ctx: null,
      chooser: parsed.ok && parsed.memberships.length > 0,
    };
  }
  const membership = parseMembership(selected.source as MembershipRow);
  if (!membership) return denied;

  let platformRole = null;
  if (platformRoleResult && !platformRoleResult.error) {
    platformRole = parseAdminRole(platformRoleResult.data);
  }

  const metadata = authUser.user_metadata;
  const user: User = {
    id: authUser.id,
    email: authUser.email,
    name: text(metadata.full_name) ?? text(metadata.name),
    avatar_url: text(metadata.avatar_url) ?? text(metadata.picture),
    // 토큰에는 가입 시각이 없다. 화면·판정 어디에서도 쓰지 않는다.
    created_at: "",
  };

  return {
    ctx: {
      user,
      org: membership.org,
      role: membership.role,
      scope: membership.scope,
      isPlatformAdmin: platformRole !== null,
    },
    chooser: false,
  };
}

async function getDevSession(
  uid: string | undefined,
  orgId: string | undefined,
): Promise<Ctx | null> {
  if (!uid) return null;
  if (process.env.NODE_ENV !== "production") {
  const repo = getRepo();
  const user = repo.getUser(uid);
  if (!user) return null;
  const org = repo.getOrg(orgId ?? SEED_ORG_ID);
  if (!org) return null;
  const membership = repo
    .listMembers(org.id)
    .find((member) => member.user_id === uid);
  if (!membership) return null;

  return {
    user,
    org,
    role: membership.role,
    scope: membership.scope,
    isPlatformAdmin: false,
  };
  }
  return null;
}

export async function getSessionOrNull(): Promise<Ctx | null> {
  const jar = await cookies();
  if (hasSupabaseEnv()) {
    return getSupabaseSession(jar.get(SESSION_COOKIE.org)?.value);
  }
  return getDevSession(
    jar.get(SESSION_COOKIE.uid)?.value,
    jar.get(SESSION_COOKIE.org)?.value,
  );
}

export async function getSession(): Promise<Ctx> {
  if (hasSupabaseEnv()) {
    const jar = await cookies();
    const { ctx, chooser } = await resolveSupabaseSession(
      jar.get(SESSION_COOKIE.org)?.value,
    );
    if (ctx) return ctx;
    redirect(chooser ? "/workspaces" : "/login?error=membership");
  }
  const ctx = await getSessionOrNull();
  if (!ctx) redirect("/login?error=membership");
  return ctx;
}

/**
 * Legacy compatibility boundary. Role/scope always come from a verified
 * workspace membership; query or cookie values never grant authorization.
 */
export function applyAs(ctx: Ctx, as: string | null | undefined): Ctx {
  void as;
  return ctx;
}
