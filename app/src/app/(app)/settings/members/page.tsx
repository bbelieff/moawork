import { getSession } from "@/lib/auth/session";
import { loadMemberOrgSummary } from "@/lib/auth/member-org-summary";
import { MemberOrganizationChart } from "@/components/member-organization/MemberOrganizationChart";
import { PermissionMatrix } from "@/components/member-organization/perm/PermissionMatrix";
import { loadPermissionMatrix } from "@/lib/perm/server";
import { isRole, type Role } from "@/lib/perm/matrix";
import { isManager } from "@/lib/auth/roles";
import { OrgLogoCard } from "@/components/org-logo/OrgLogoCard";
import { loadOrgLogoView } from "@/lib/org-logo/server";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const ctx = await getSession();
  const requestedRole = (await searchParams).role;
  const activeRole: Role = requestedRole && isRole(requestedRole) ? requestedRole : "member";
  const [summary, permission, logo] = await Promise.all([
    loadMemberOrgSummary(ctx),
    loadPermissionMatrix(ctx.org.id),
    loadOrgLogoView(ctx.org.id),
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

      {/*
        회사 로고 — **목업에 없는 자리다.** 목업 전체(v6)를 훑어도 회사 로고를 올리는 칸은
        없고, 「로고」 언급 3건은 전부 MoaWork 브랜드 마크다. 그러니 어디에 둘지는 우리가 정한다.

        여기로 정한 이유: 이 화면의 제목이 「우리 회사와 팀」이고 로고는 곧 «그 회사가 누구인가» 다.
        사이드바 회사명 옆에 바로 나타나므로, 회사를 설명하는 이 화면 맨 위가 자연스럽다.
        (목업 조직관리는 «조직도 · 조직원 · 보고 계통 · 알림 대상» 이 주제라 로고 자리가 없다 —
         그 네 가지는 아직 제품에 없고, 그건 이 카드와 별개의 후속이다.)
      */}
      <OrgLogoCard orgName={ctx.org.name} logo={logo} canManage={isManager(ctx.role)} />

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
      {summary.kind === "unavailable" ? <section role="alert" className="rounded-2xl border border-red-200 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300">회사 구성원 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</section> : null}
      {summary.kind === "error" ? <section role="alert" className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">회사 구성원 정보를 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.</section> : null}
      {summary.kind === "owner_integrity_error" ? <section role="alert" className="rounded-2xl border border-red-200 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300">보호된 대표 정보를 안전하게 확인하지 못했어요. 이 화면에서는 어떤 권한도 바꿀 수 없어요.</section> : null}
      {/*
        2026-08-26 — 인원 수를 넘긴다. 안 넘기면 역할 목록이 전부 «0» 으로 보이는데,
        회사에 사람이 있는데도 0 이라고 «단언» 하는 화면이 된다. 요약은 이미 위에서 읽었다.
        집계를 못 읽었으면(summary.kind !== "ready") 아예 넘기지 않는다 — 틀린 숫자보다 낫다.
      */}
      <PermissionMatrix
        orgId={ctx.org.id}
        activeRole={activeRole}
        viewerRole={viewerRole}
        access={permissionAccess}
        roleMemberCounts={summary.kind === "ready"
          ? { owner: summary.owner ? 1 : 0, admin: summary.admins.length, member: summary.members.length }
          : undefined}
        revalidatePath="/settings/members"
      />
    </div>
  );
}
