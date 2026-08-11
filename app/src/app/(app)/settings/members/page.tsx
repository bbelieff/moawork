import { getSession } from "@/lib/auth/session";
import { loadMemberOrgSummary } from "@/lib/auth/member-org-summary";
import { MemberOrganizationChart } from "@/components/member-organization/MemberOrganizationChart";
import { PermissionMatrix } from "@/components/member-organization/perm/PermissionMatrix";
import { loadPermissionMatrix } from "@/lib/perm/server";
import { isRole, type Role } from "@/lib/perm/matrix";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const ctx = await getSession();
  const requestedRole = (await searchParams).role;
  const activeRole: Role = requestedRole && isRole(requestedRole) ? requestedRole : "member";
  const [summary, permission] = await Promise.all([
    loadMemberOrgSummary(ctx),
    loadPermissionMatrix(ctx.org.id),
  ]);
  const viewerRole: Role = ctx.role === "owner" || ctx.role === "admin" ? ctx.role : "member";
  const permissionAccess = permission.ok
    ? { kind: "allowed" as const, snapshot: permission.snapshot }
    : { kind: "denied" as const, reason: permission.reason };

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
      <PermissionMatrix
        orgId={ctx.org.id}
        activeRole={activeRole}
        viewerRole={viewerRole}
        access={permissionAccess}
        revalidatePath="/settings/members"
      />
    </div>
  );
}
