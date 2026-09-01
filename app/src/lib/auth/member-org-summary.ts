import { MEMBER_ROLES, MEMBER_SCOPES, type Ctx, type MemberRole, type MemberScope } from "@/lib/types";
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

/*
 * ★ 목록을 «손으로 적지» 않는다. 정본(MEMBER_ROLES · MEMBER_SCOPES)에서 파생시킨다.
 *
 *   전에는 여기에 `owner|admin|member` 와 `all|assigned` 를 손으로 적어 뒀는데,
 *   정본에는 `team_lead` 와 `department` 가 있었다. **가드가 정본보다 좁았다.**
 *   그러면 팀장인 행이 아래 flatMap 에서 «조용히» 버려지고, 그 사람은 화면에서 사라진다.
 *   그 뒤 자리 갈래는 「그 부서에 팀장이 없다」고 읽어 **붉은 「공석」을 단언한다** —
 *   앉아 있는 사람을 두고 화면이 거짓을 말한다 (#683 검수 P0-1).
 *
 *   목록을 늘려 고치면 다음에 역할이 하나 더 생길 때 똑같이 어긋난다.
 *   정본에서 파생시키면 **어긋날 자리가 없어진다.**
 */
function isRole(value: unknown): value is MemberRole {
  return typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value);
}

function isScope(value: unknown): value is MemberScope {
  return typeof value === "string" && (MEMBER_SCOPES as readonly string[]).includes(value);
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
    /*
     * ★ 「role === 'member' 인 사람」이 아니라 **「나머지 전부」** 다.
     *
     *   전에는 `=== "member"` 였다. 그래서 `team_lead` 는 owner 도 admin 도 member 도 아니라서
     *   **어느 칸에도 안 담기고 사라졌다.** 가드를 넓혀 여기까지 왔는데 여기서 다시 버려졌다 —
     *   한 값이 두 곳에서 따로 버려지고 있었다 (#683 검수 P0-1).
     *
     *   칸이 역할을 «열거» 하는 한 역할이 하나 늘 때마다 같은 일이 난다.
     *   「나머지」로 두면 새 역할이 생겨도 담길 곳이 있다. 각 행은 자기 `role` 을 그대로 들고
     *   가므로, 팀장을 팀장으로 그려야 하는 화면은 그 값을 보면 된다.
     */
    members: members
      .filter((member) => member.role !== "owner" && member.role !== "admin")
      .sort(compareMembers),
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
