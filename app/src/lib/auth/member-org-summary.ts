import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MemberSummaryRow = {
  orgId: string;
  userId: string;
  displayName: string;
  role: MemberRole;
  scope: MemberScope;
  title: string | null;
  teamKey: string | null;
  createdAt: string;
};

export type MemberOrgSummary =
  | { kind: "ready"; owner: MemberSummaryRow; admins: MemberSummaryRow[]; members: MemberSummaryRow[] }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "owner_integrity_error" };

type MembershipDbRow = {
  org_id: unknown;
  user_id: unknown;
  role: unknown;
  scope: unknown;
  created_at: unknown;
  users: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRole(value: unknown): value is MemberRole {
  return value === "owner" || value === "admin" || value === "member";
}

function isScope(value: unknown): value is MemberScope {
  return value === "all" || value === "assigned";
}

function displayName(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return "이름 미등록";
  const name = text((candidate as Record<string, unknown>).name)?.trim();
  return name || "이름 미등록";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

type ProfileRpcRow = {
  id: unknown;
  name: unknown;
  title: unknown;
  team_key: unknown;
};

function profileRow(value: unknown, expectedUserId: string): {
  displayName: string;
  title: string | null;
  teamKey: string | null;
} | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ProfileRpcRow;
  if (text(row.id) !== expectedUserId) return null;
  const name = nullableText(row.name);
  if (!name) return null;
  return { displayName: name, title: nullableText(row.title), teamKey: nullableText(row.team_key) };
}

function compareMembers(left: MemberSummaryRow, right: MemberSummaryRow): number {
  return left.createdAt.localeCompare(right.createdAt) || left.userId.localeCompare(right.userId);
}

export function buildMemberOrgSummary(orgId: string, rows: readonly MembershipDbRow[]): MemberOrgSummary {
  const members = rows.flatMap((row): MemberSummaryRow[] => {
    const rowOrgId = text(row.org_id);
    const userId = text(row.user_id);
    const createdAt = text(row.created_at);
    if (rowOrgId !== orgId || !userId || !createdAt || !isRole(row.role) || !isScope(row.scope)) return [];
    return [{ orgId: rowOrgId, userId, displayName: displayName(row.users), role: row.role, scope: row.scope, title: null, teamKey: null, createdAt }];
  });

  const owners = members.filter((member) => member.role === "owner");
  if (owners.length !== 1 || owners[0].scope !== "all") return { kind: "owner_integrity_error" };
  return {
    kind: "ready",
    owner: owners[0],
    admins: members.filter((member) => member.role === "admin").sort(compareMembers),
    members: members.filter((member) => member.role === "member").sort(compareMembers),
  };
}

export function applyMemberProfiles(
  summary: MemberOrgSummary,
  profiles: ReadonlyMap<string, unknown>,
): MemberOrgSummary {
  if (summary.kind !== "ready") return summary;
  const hydrate = (member: MemberSummaryRow): MemberSummaryRow | null => {
    const profile = profileRow(profiles.get(member.userId), member.userId);
    return profile ? { ...member, ...profile } : null;
  };
  const owner = hydrate(summary.owner);
  const admins = summary.admins.map(hydrate);
  const members = summary.members.map(hydrate);
  if (!owner || admins.some((member) => !member) || members.some((member) => !member)) {
    return { kind: "error" };
  }
  return { kind: "ready", owner, admins: admins as MemberSummaryRow[], members: members as MemberSummaryRow[] };
}

/** Authenticated RLS read only. This module never mutates org_members. */
export async function loadMemberOrgSummary(ctx: Ctx): Promise<MemberOrgSummary> {
  if (!hasSupabaseEnv()) return { kind: "unavailable" };
  return loadMemberOrgSummaryWithClient(await createClient(), ctx);
}

/** Same request-scoped client variant for bootstrap and other atomic request graphs. */
export async function loadMemberOrgSummaryWithClient(
  supabase: SupabaseClient,
  ctx: Ctx,
): Promise<MemberOrgSummary> {
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, user_id, role, scope, created_at, users!inner(name)")
    .eq("org_id", ctx.org.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error || !Array.isArray(data)) return { kind: "error" };
  const summary = buildMemberOrgSummary(ctx.org.id, data as MembershipDbRow[]);
  if (summary.kind !== "ready") return summary;

  const allMembers = [summary.owner, ...summary.admins, ...summary.members];
  const profileResults = await Promise.all(
    allMembers.map(async (member) => {
      const { data: profile, error: profileError } = await supabase.rpc(
        "get_member_account_profile",
        { p_org_id: ctx.org.id, p_target_user_id: member.userId },
      );
      return { userId: member.userId, profile, profileError };
    }),
  );
  if (profileResults.some((result) => result.profileError)) return { kind: "error" };
  return applyMemberProfiles(
    summary,
    new Map(profileResults.map((result) => [result.userId, result.profile])),
  );
}
