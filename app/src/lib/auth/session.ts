import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Ctx, MemberScope, Org, User } from "@/lib/types";
import { isMemberRole, isMemberScope } from "@/lib/auth/roles";
import { adminGrantFromFallback, parseAdminRole } from "@/lib/auth/admin";
import { getRepo } from "@/lib/repo";
import { SEED_ORG_ID } from "@/lib/repo/local/seed";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export const SESSION_COOKIE = {
  uid: "mw_uid",
  org: "mw_org",
  as: "mw_as",
} as const;

type MembershipRow = {
  org_id: unknown;
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

async function getSupabaseSession(
  preferredOrgId: string | undefined,
): Promise<Ctx | null> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !authUser) return null;
  const authUserId = authUser.id;

  async function findMembership(orgId?: string) {
    let query = supabase
      .from("org_members")
      .select("org_id, role, scope, orgs(id, name, plan_tier, created_at)")
      .eq("user_id", authUserId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (orgId) query = query.eq("org_id", orgId);
    const { data, error } = await query.maybeSingle();
    return error ? null : parseMembership(data as MembershipRow | null);
  }

  const membership =
    (preferredOrgId ? await findMembership(preferredOrgId) : null) ??
    (await findMembership());
  if (!membership) return null;

  let platformRole = null;
  if (authUser.email) {
    const { data, error } = await supabase.rpc("app_admin_role", {
      p_email: authUser.email,
    });
    if (!error) platformRole = parseAdminRole(data);
  }

  const metadata = authUser.user_metadata ?? {};
  const user: User = {
    id: authUser.id,
    email: authUser.email ?? null,
    name: text(metadata.full_name) ?? text(metadata.name),
    avatar_url: text(metadata.avatar_url) ?? text(metadata.picture),
    created_at: authUser.created_at,
  };

  return {
    user,
    org: membership.org,
    role: platformRole ?? membership.role,
    scope: platformRole ? "all" : membership.scope,
    isPlatformAdmin: platformRole !== null,
  };
}

async function getDevSession(
  uid: string | undefined,
  orgId: string | undefined,
  as: string | undefined,
): Promise<Ctx | null> {
  if (!uid || process.env.NODE_ENV === "production") return null;
  const repo = getRepo();
  const user = repo.getUser(uid);
  if (!user) return null;
  const org = repo.getOrg(orgId ?? SEED_ORG_ID);
  if (!org) return null;
  const membership = repo
    .listMembers(org.id)
    .find((member) => member.user_id === uid);
  if (!membership) return null;

  const grant = adminGrantFromFallback(user.email);
  return applyAs(
    {
      user,
      org,
      role: grant ? grant.role : membership.role,
      scope: grant ? "all" : membership.scope,
      isPlatformAdmin: grant?.isPlatform ?? false,
    },
    as,
  );
}

export async function getSessionOrNull(): Promise<Ctx | null> {
  const jar = await cookies();
  if (hasSupabaseEnv()) {
    return getSupabaseSession(jar.get(SESSION_COOKIE.org)?.value);
  }
  return getDevSession(
    jar.get(SESSION_COOKIE.uid)?.value,
    jar.get(SESSION_COOKIE.org)?.value,
    jar.get(SESSION_COOKIE.as)?.value,
  );
}

export async function getSession(): Promise<Ctx> {
  const ctx = await getSessionOrNull();
  if (!ctx) redirect("/login?error=membership");
  return ctx;
}

/** 개발 전용 역할 오버라이드. 운영에서는 호출되어도 권한을 바꾸지 않는다. */
export function applyAs(ctx: Ctx, as: string | null | undefined): Ctx {
  if (process.env.NODE_ENV === "production" || !isMemberRole(as)) return ctx;
  const scope: MemberScope = as === "member" ? "assigned" : "all";
  return { ...ctx, role: as, scope };
}
