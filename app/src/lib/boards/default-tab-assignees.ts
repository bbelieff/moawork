import type { Ctx } from "@/lib/types";
import { loadMemberOrgSummary, type MemberOrgSummary } from "@/lib/auth/member-org-summary";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
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
  // ★ BBE-203 — 아래 else 는 로컬 시드 담당자를 돌려준다. env 유무«만» 보면 운영에서
  //   env 가 빠졌을 때 시드 담당자가 조용히 기본 탭에 박힌다. 운영에서는 시끄럽게 실패한다.
  if (!canUseLocalSeedFallback()) {
    const summary = await loadMemberOrgSummary(ctx);
    const assignees = assigneesFromMemberSummary(summary);
    if (summary.kind !== "ready" || assignees.length === 0) {
      throw new Error("활성 조직 멤버를 확인하지 못해 기본 탭 담당자를 동기화할 수 없습니다.");
    }
    return assignees;
  }

  const members = (await import("@/lib/repo/local/defaultTabAssignees"))
    .loadLocalDefaultTabAssignees(ctx);
  if (members.some((member) => member.userId === ctx.user.id)) return members;
  return [
    { userId: ctx.user.id, displayName: ctx.user.name?.trim() || ctx.user.email?.trim() || "멤버" },
    ...members,
  ];
}
