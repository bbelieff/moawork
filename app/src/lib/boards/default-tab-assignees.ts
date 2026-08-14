import type { Ctx } from "@/lib/types";
import { loadMemberOrgSummary, type MemberOrgSummary } from "@/lib/auth/member-org-summary";
import { getRepo } from "@/lib/repo";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { DefaultTabAssignee } from "@/lib/default-tabs/types";

export function assigneesFromMemberSummary(summary: MemberOrgSummary): DefaultTabAssignee[] {
  if (summary.kind !== "ready") return [];
  return [summary.owner, ...summary.admins, ...summary.members].map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
  }));
}

/** Loads active workspace members through authenticated org_members in production. */
export async function loadDefaultTabAssignees(ctx: Ctx): Promise<DefaultTabAssignee[]> {
  if (hasSupabaseEnv()) {
    const summary = await loadMemberOrgSummary(ctx);
    const assignees = assigneesFromMemberSummary(summary);
    if (summary.kind !== "ready" || assignees.length === 0) {
      throw new Error("활성 조직 멤버를 확인하지 못해 기본 탭 담당자를 동기화할 수 없습니다.");
    }
    return assignees;
  }

  const members = getRepo()
    .listMembers(ctx.org.id)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((member) => ({
      userId: member.user_id,
      displayName: member.user?.name?.trim() || member.user?.email?.trim() || "멤버",
    }));
  if (members.some((member) => member.userId === ctx.user.id)) return members;
  return [
    { userId: ctx.user.id, displayName: ctx.user.name?.trim() || ctx.user.email?.trim() || "멤버" },
    ...members,
  ];
}
