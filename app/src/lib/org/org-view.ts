import type { MemberRole, MemberScope } from "@/lib/types";
import type { MemberSummaryRow } from "@/lib/auth/member-org-summary";
import { toTree, type DepartmentTreeRow, type OrgChart } from "@/lib/org/departments";
import { resolveReportsTo, type ReportingContext } from "@/lib/org/reporting";

/**
 * #640 — 조직관리 「목록」 갈래가 그리는 표의 «재료».
 *
 * ★ 왜 별도 모듈인가
 *   부서(departments.ts)와 사람(member-org-summary.ts)과 보고 계통(reporting.ts)이
 *   서로 다른 세 곳에서 온다. 그 셋을 «한 줄» 로 합치는 곳이 없으면 그 합치는 일이
 *   화면 컴포넌트 안으로 들어가고, 그러면 검사할 수가 없다.
 *   #638 이 이름 붙인 「판정→화면 배선에 시험이 없다」가 정확히 그 병이다.
 *
 * ★ reporting.ts 의 첫 «화면» 소비자가 여기다.
 *   013 의 member_hierarchy_assignments 는 지금까지 아무도 읽지 않았다(reporting.ts 주석).
 *   그 값을 읽어 실제로 보여 주는 첫 경로다.
 */

export type OrgMemberView = {
  userId: string;
  displayName: string;
  /** 호칭·직책. 없으면 화면이 「호칭 미설정」이라고 말한다. */
  title: string | null;
  departmentIds: string[];
  primaryDepartmentId: string | null;
  /** 주부서 이름. 미배정이면 null. */
  primaryDepartmentName: string | null;
  role: MemberRole;
  scope: MemberScope;
  reportsToUserId: string | null;
  reportsToName: string | null;
  /** 자기 주부서의 책임자인가 — 목업이 「(상위)」 꼬리표를 붙이는 조건이다. */
  isHeadOfPrimary: boolean;
  active: boolean;
};

export type OrgViewModel = {
  departments: DepartmentTreeRow[];
  members: OrgMemberView[];
  unassignedCount: number;
  /**
   * ★ 보고 예외(013)를 «읽었는가».
   *   못 읽었으면 reportsTo 는 예외를 무시한 값이라 틀릴 수 있다.
   *   그때 화면은 「모름」이라고 말해야지 틀린 이름을 단언하면 안 된다.
   *   빈 Map(=예외 0건)과 null(=못 읽음)은 다른 사실이다.
   */
  reportingKnown: boolean;
};

/** 자기 자신을 뺀 하위 부서 전부. 순환이 있어도 멈춘다. */
export function descendantDepartmentIds(
  rootId: string,
  departments: readonly { id: string; parentId: string | null }[],
): Set<string> {
  const byParent = new Map<string | null, string[]>();
  for (const node of departments) {
    const bucket = byParent.get(node.parentId) ?? [];
    bucket.push(node.id);
    byParent.set(node.parentId, bucket);
  }
  const out = new Set<string>();
  const stack = [...(byParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (out.has(id)) continue; // 순환 방어 — DB 가 self-parent 만 막는다
    out.add(id);
    stack.push(...(byParent.get(id) ?? []));
  }
  return out;
}

/**
 * 부서 하나를 골랐을 때 오른쪽에 뜨는 사람들.
 * deptId 가 null 이면 «전체» — 미배정까지 전부 포함한다.
 */
export function membersOfDepartment(
  model: OrgViewModel,
  deptId: string | null,
  includeSub: boolean,
): OrgMemberView[] {
  if (deptId === null) return model.members;
  const targets = new Set<string>([deptId]);
  if (includeSub) {
    for (const id of descendantDepartmentIds(deptId, model.departments)) targets.add(id);
  }
  return model.members.filter((member) => member.departmentIds.some((id) => targets.has(id)));
}

export function buildOrgViewModel(input: {
  chart: Extract<OrgChart, { kind: "ready" }>;
  owner: MemberSummaryRow;
  admins: readonly MemberSummaryRow[];
  members: readonly MemberSummaryRow[];
  /** null = 읽지 못했다. 빈 Map = 예외가 0건이다. 둘은 다른 사실이다. */
  exceptions: ReadonlyMap<string, string | null> | null;
}): OrgViewModel {
  const { chart, owner, admins, members, exceptions } = input;

  const summaryByUser = new Map<string, MemberSummaryRow>();
  for (const row of [owner, ...admins, ...members]) summaryByUser.set(row.userId, row);

  const deptById = new Map(chart.departments.map((d) => [d.id, d]));
  const primaryDeptOf = new Map<string, string | null>();
  for (const member of chart.members) primaryDeptOf.set(member.userId, member.primaryDepartmentId);

  const reportingCtx: ReportingContext = {
    departments: chart.departments.map((d) => ({ id: d.id, parentId: d.parentId, headUserId: d.headUserId })),
    primaryDeptOf,
    exceptionOf: exceptions ?? new Map<string, string | null>(),
    ownerUserId: owner.userId,
  };

  const nameOf = new Map<string, string>();
  for (const member of chart.members) nameOf.set(member.userId, member.displayName);
  for (const row of summaryByUser.values()) if (!nameOf.has(row.userId)) nameOf.set(row.userId, row.displayName);

  const views: OrgMemberView[] = [];
  for (const member of chart.members) {
    const summary = summaryByUser.get(member.userId);
    // 조직도에는 있는데 멤버십 요약에 없는 사람은 역할을 «모른다». 추측해서 그리지 않는다.
    if (!summary) continue;
    const primaryDept = member.primaryDepartmentId ? deptById.get(member.primaryDepartmentId) ?? null : null;
    const reportsToUserId = resolveReportsTo(member.userId, reportingCtx);
    views.push({
      userId: member.userId,
      displayName: member.displayName,
      title: summary.title,
      departmentIds: member.departmentIds,
      primaryDepartmentId: member.primaryDepartmentId,
      primaryDepartmentName: primaryDept ? primaryDept.name : null,
      role: summary.role,
      scope: summary.scope,
      reportsToUserId,
      reportsToName: reportsToUserId ? nameOf.get(reportsToUserId) ?? null : null,
      isHeadOfPrimary: primaryDept ? primaryDept.headUserId === member.userId : false,
      active: member.active,
    });
  }

  views.sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));

  return {
    departments: toTree(chart.departments, chart.members),
    members: views,
    unassignedCount: chart.unassignedCount,
    reportingKnown: exceptions !== null,
  };
}
