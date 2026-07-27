import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export type MemberSummaryRow = {
  orgId: string;
  userId: string;
  displayName: string;
  role: MemberRole;
  scope: MemberScope;
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

function compareMembers(left: MemberSummaryRow, right: MemberSummaryRow): number {
  return left.createdAt.localeCompare(right.createdAt) || left.userId.localeCompare(right.userId);
}

export function buildMemberOrgSummary(orgId: string, rows: readonly MembershipDbRow[]): MemberOrgSummary {
  const members = rows.flatMap((row): MemberSummaryRow[] => {
    const rowOrgId = text(row.org_id);
    const userId = text(row.user_id);
    const createdAt = text(row.created_at);
    if (rowOrgId !== orgId || !userId || !createdAt || !isRole(row.role) || !isScope(row.scope)) return [];
    return [{ orgId: rowOrgId, userId, displayName: displayName(row.users), role: row.role, scope: row.scope, createdAt }];
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

/** Authenticated RLS read only. This module never mutates org_members. */
export async function loadMemberOrgSummary(ctx: Ctx): Promise<MemberOrgSummary> {
  if (!hasSupabaseEnv()) return { kind: "unavailable" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, user_id, role, scope, created_at, users!inner(name)")
    .eq("org_id", ctx.org.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error || !Array.isArray(data)) return { kind: "error" };
  return buildMemberOrgSummary(ctx.org.id, data as MembershipDbRow[]);
}
