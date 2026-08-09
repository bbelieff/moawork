import { getSession } from "@/lib/auth/session";
import { loadMemberOrgSummary } from "@/lib/auth/member-org-summary";
import { MemberOrganizationChart } from "@/components/member-organization/MemberOrganizationChart";

export default async function MembersPage() {
  const ctx = await getSession();
  const summary = await loadMemberOrgSummary(ctx);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">우리 회사와 팀</h1>
        <p className="mt-1 text-sm text-zinc-500">{ctx.org.name}에서 함께 일하는 사람과 업무 범위를 확인해요.</p>
      </header>

      {summary.kind === "ready" ? (
        <MemberOrganizationChart
          orgId={ctx.org.id}
          owner={summary.owner}
          admins={summary.admins}
          members={summary.members}
          canEditProfiles={ctx.role === "owner"}
          viewerUserId={ctx.user.id}
        />
      ) : null}
      {summary.kind === "unavailable" ? <section role="status" className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">회사 구성원 정보는 서버 연결이 준비되면 안전하게 보여드려요.</section> : null}
      {summary.kind === "error" ? <section role="alert" className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">회사 구성원 정보를 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.</section> : null}
      {summary.kind === "owner_integrity_error" ? <section role="alert" className="rounded-2xl border border-red-200 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300">보호된 대표 정보를 안전하게 확인하지 못했어요. 이 화면에서는 어떤 권한도 바꿀 수 없어요.</section> : null}
    </div>
  );
}
