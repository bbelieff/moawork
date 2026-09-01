import { getSession } from "@/lib/auth/session";
import { loadMemberOrgSummary } from "@/lib/auth/member-org-summary";
import { MemberOrganizationChart } from "@/components/member-organization/MemberOrganizationChart";
import { PermissionMatrix } from "@/components/member-organization/perm/PermissionMatrix";
import { loadPermissionMatrix } from "@/lib/perm/server";
import { isRole, type Role } from "@/lib/perm/matrix";
import { isManager } from "@/lib/auth/roles";
import { OrgLogoCard } from "@/components/org-logo/OrgLogoCard";
import { loadOrgLogoView } from "@/lib/org-logo/server";
import { loadOrgChart } from "@/lib/org/departments";
import { loadReportingExceptions } from "@/lib/org/reporting-exceptions";
import { selectOrgViewModel, isOrgView, type OrgView } from "@/lib/org/org-view";
import { DepartmentManager } from "@/components/member-organization/DepartmentManager";
import { OrgViewTabs } from "@/components/member-organization/OrgViewTabs";
import { createClient } from "@/lib/supabase/server";
import { loadSeatDefinitions, withSeatDefinitionNames } from "@/lib/org/seat-definitions";

/**
 * 역할별 인원수 — «각 사람이 들고 있는 역할» 로 센다.
 *
 * ★ summary 의 칸 이름으로 세지 않는다. `members` 칸은 «owner·admin 이 아닌 나머지 전부» 라
 *   팀장도 거기 들어 있다. 칸 길이를 그대로 쓰면 팀장이 「담당」으로 세어진다 (#683 검수 P0-1).
 */
function countByRole(summary: { owner: { role: string }; admins: { role: string }[]; members: { role: string }[] }) {
  const counts: Partial<Record<Role, number>> = {};
  for (const member of [summary.owner, ...summary.admins, ...summary.members]) {
    if (!isRole(member.role)) continue;
    counts[member.role] = (counts[member.role] ?? 0) + 1;
  }
  return counts;
}

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ role?: string; view?: string }> }) {
  const ctx = await getSession();
  const params = await searchParams;
  const requestedRole = params.role;
  const activeRole: Role = requestedRole && isRole(requestedRole) ? requestedRole : "member";

  /*
   * #640 — 어느 갈래를 열고 시작할지.
   *
   * ★ 권한표의 역할 링크는 <a href="?role=..."> 라서 «전체 재적재» 다(Next 16).
   *   그 링크는 view 질의를 안 달고 가므로, role 만 있는 주소는 «권한 화면을 보던 중»
   *   이라는 뜻으로 읽는다. 안 그러면 역할을 누를 때마다 목록으로 튕긴다.
   */
  const initialView: OrgView = isOrgView(params.view) ? params.view : requestedRole ? "perm" : "list";
  const [summary, permission, logo, chart, exceptions, seatDefinitions] = await Promise.all([
    loadMemberOrgSummary(ctx),
    loadPermissionMatrix(ctx.org.id),
    loadOrgLogoView(ctx.org.id),
    // #571 — 조직도. 다른 읽기와 «같은 물결» 에서 나간다(뒤에 붙이면 왕복이 는다).
    loadOrgChart(ctx, createClient),
    // #640 — 보고 «예외»(013). 같은 물결에 태운다. null 이면 «못 읽음» 이고 화면이 그렇게 말한다.
    loadReportingExceptions(ctx, createClient),
    // #683 — 자리의 역할 정의서. 역시 같은 물결이고, null 은 «못 읽음» 이다.
    loadSeatDefinitions(ctx, createClient),
  ]);
  /*
   * #683 — 「누가 썼나」에 이름을 붙인다.
   *   정의서는 요약과 «같은 물결» 로 나가서 읽는 시점엔 이름표가 없다. 여기서 입힌다 —
   *   안 하면 화면이 계속 「누군가가 씀」이라고 말한다. 우리는 누구인지 알고 있는데도.
   */
  const namedSeatDefinitions = withSeatDefinitionNames(seatDefinitions, (userId) => {
    if (summary.kind !== "ready") return null;
    const found = [summary.owner, ...summary.admins, ...summary.members].find(
      (member) => member.userId === userId,
    );
    return found?.displayName ?? null;
  });

  const viewerRole: Role = ctx.role === "owner" || ctx.role === "admin" ? ctx.role : "member";
  const permissionAccess = permission.ok
    ? { kind: "allowed" as const, snapshot: permission.snapshot }
    : { kind: "denied" as const, reason: permission.reason };

  // #640 — 부서·사람·보고 계통 셋을 한 재료로 합친다.
  // «합칠 수 있는 상태인가» 의 판단까지 selectOrgViewModel 이 갖는다 — 여기 삼항으로 두면
  // 그 판단에 시험을 붙일 자리가 없어진다(#638 「판정→화면 배선 무검사」).
  const model = selectOrgViewModel({ chart, summary, exceptions });

  const departmentSlot = <DepartmentManager chart={chart} canManage={isManager(ctx.role)} />;

  const permissionSlot = (
    <>
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
        roleMemberCounts={summary.kind === "ready" ? countByRole(summary) : undefined}
        revalidatePath="/settings/members"
      />
    </>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">우리 회사와 팀</h1>
        <p className="mt-1 text-sm text-zinc-500">{ctx.org.name}에서 함께 일하는 사람과 업무 범위를 확인해요.</p>
      </header>

      {/* BBE-199 — 로고는 조직 구조와 별개인 워크스페이스 식별 설정이다. 네 갈래 어디에도 속하지 않는다. */}
      <OrgLogoCard orgName={ctx.org.name} logo={logo} canManage={isManager(ctx.role)} />

      {model ? (
        // #640 ①②③ — 보는 방식 네 갈래 · 가로 조직도 · 부서↔사람 잇기.
        <OrgViewTabs
          model={model}
          initialView={initialView}
          departmentSlot={departmentSlot}
          permissionSlot={permissionSlot}
          seatDefinitions={namedSeatDefinitions}
          canManageSeats={isManager(ctx.role)}
        />
      ) : (
        // 못 읽었을 때는 갈래를 만들지 않는다 — 빈 갈래는 «부서가 없다» 는 거짓말이 된다.
        // 대신 기존 화면을 그대로 두고 무엇을 못 읽었는지 말한다.
        <>
          {departmentSlot}
          {permissionSlot}
        </>
      )}

      {summary.kind === "unavailable" ? <section role="alert" className="rounded-2xl border border-red-200 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300">회사 구성원 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</section> : null}
      {summary.kind === "error" ? <section role="alert" className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">회사 구성원 정보를 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.</section> : null}
      {summary.kind === "owner_integrity_error" ? <section role="alert" className="rounded-2xl border border-red-200 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300">보호된 대표 정보를 안전하게 확인하지 못했어요. 이 화면에서는 어떤 권한도 바꿀 수 없어요.</section> : null}
    </div>
  );
}
