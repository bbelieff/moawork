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

/**
 * 조직관리의 «보는 방식» 네 갈래.
 *
 * ★ 왜 컴포넌트가 아니라 여기 있나 — 화면 파일이 "use client" 라서, 거기서 내보낸 함수는
 *   서버가 부를 수 없다("Attempted to call isOrgView() from the server").
 *   타입 검사는 통과하고 «실행할 때» 500 이 난다 — 화면을 열어야만 잡히는 종류다.
 *   서버(page.tsx)와 클라이언트가 같이 쓰는 값이므로 공용 모듈이 갖는다.
 */
/*
 * #683 — 「자리」 를 «더한다». 기존 넷은 그대로 둔다.
 *
 * ★ D안은 결국 이 갈래 하나로 나머지를 흡수하는 것이 목표지만, 한 번에 지우지 않는다.
 *   지금 조직관리는 실측 «조작 0건» 이라 «쓰이는지» 부터 확인해야 하고,
 *   구조가 줄어든 변경은 무조건 FAIL 이다(D71~D75).
 *   자리가 실제로 쓰이는 것을 보고 나서 옛 갈래를 정리한다.
 */
export const ORG_VIEWS = ["seats", "list", "chart", "perm", "rules"] as const;
export type OrgView = (typeof ORG_VIEWS)[number];

export function isOrgView(value: unknown): value is OrgView {
  return typeof value === "string" && (ORG_VIEWS as readonly string[]).includes(value);
}

export type OrgMemberView = {
  userId: string;
  displayName: string;
  /** 호칭·직책. 없으면 화면이 「호칭 미설정」이라고 말한다 — 단 titleKnown 이 true 일 때만. */
  title: string | null;
  /**
   * ★ 호칭을 «읽었는가» (#644 ③).
   *   role·scope 는 모를 때 null 로 「확인 못 함」이라고 말하는데, 호칭만 null 을
   *   「설정 안 함」으로 떨어뜨리고 있었다. 그 둘은 다른 사실이다 —
   *   멤버십 요약에서 빠진 사람(team_lead·비활성)은 호칭이 «없는» 게 아니라 «못 읽은» 것이고,
   *   실제로 member_account_profiles 에는 값이 들어 있을 수 있다.
   *   같은 행에서 역할은 「확인 못 함」인데 호칭만 「미설정」이라 단언하면 그 줄이 거짓말을 한다.
   */
  titleKnown: boolean;
  departmentIds: string[];
  primaryDepartmentId: string | null;
  /** 주부서 이름. 미배정이면 null. */
  primaryDepartmentName: string | null;
  /**
   * ★ null = «모른다». 「구성원이다」가 아니다.
   *   멤버십 요약(member-org-summary.ts)의 isRole 은 owner/admin/member 만 통과시킨다 —
   *   054 가 enum 에 넣은 team_lead 와 비활성 구성원은 그 관문에서 빠진다.
   *   전에는 그런 사람을 표에서 «버렸다». 그러면 왼쪽 트리는 4명이라 하고 오른쪽 표는
   *   2행이라 하는, 한 화면이 한 부서를 서로 다른 수로 말하는 상태가 된다.
   *   버리지 않고 넣되, 모르는 칸은 「확인 못 함」이라고 말한다.
   */
  role: MemberRole | null;
  scope: MemberScope | null;
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

/**
 * 화면이 «표를 그릴 수 있는가» 를 판단한다.
 *
 * ★ 이 판단이 화면 파일 안에 삼항 연산자로 있으면 아무도 검사할 수 없다.
 *   #638 이 이름 붙인 「판정→화면 배선 무검사」가 정확히 그 자리다 —
 *   계산에는 시험이 16개 있는데 «언제 그 계산을 쓰는가» 에는 0개인 상태.
 *   그래서 함수로 뺀다.
 *
 * 조직도나 멤버십 요약 중 하나라도 못 읽었으면 null 이다. 반쪽 데이터로 표를 그리면
 * 「부서가 없다」·「사람이 없다」고 «단언» 하는 화면이 된다 — 못 읽은 것과 없는 것은 다르다.
 */
export function selectOrgViewModel(input: {
  chart: OrgChart;
  summary: { kind: string } & Partial<{ owner: MemberSummaryRow; admins: MemberSummaryRow[]; members: MemberSummaryRow[] }>;
  exceptions: ReadonlyMap<string, string | null> | null;
}): OrgViewModel | null {
  const { chart, summary, exceptions } = input;
  if (chart.kind !== "ready") return null;
  if (summary.kind !== "ready" || !summary.owner) return null;
  return buildOrgViewModel({
    chart,
    owner: summary.owner,
    admins: summary.admins ?? [],
    members: summary.members ?? [],
    exceptions,
  });
}

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
    /*
     * ★ 요약에 없는 사람을 «버리지» 않는다.
     *   버리면 왼쪽 트리(조직도 기준)와 오른쪽 표(요약 기준)의 모집단이 갈려서
     *   한 화면이 같은 부서를 4 · 2 · 3 · 3 이라고 동시에 말하게 된다.
     *   모르는 것은 버리는 게 아니라 «모른다» 고 말한다.
     */
    const summary = summaryByUser.get(member.userId) ?? null;
    const primaryDept = member.primaryDepartmentId ? deptById.get(member.primaryDepartmentId) ?? null : null;
    const reportsToUserId = resolveReportsTo(member.userId, reportingCtx);
    views.push({
      userId: member.userId,
      displayName: member.displayName,
      title: summary ? summary.title : null,
      titleKnown: summary !== null,
      departmentIds: member.departmentIds,
      primaryDepartmentId: member.primaryDepartmentId,
      primaryDepartmentName: primaryDept ? primaryDept.name : null,
      role: summary ? summary.role : null,
      scope: summary ? summary.scope : null,
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
    /*
     * ★ 「미배정」을 여기서 «다시» 센다. chart.unassignedCount 를 그대로 쓰지 않는다.
     *   저쪽 공식은 «활성 && 주부서 없음» 이고, 조직도 갈래의 미배정 상자는
     *   «부서가 하나도 없음» 으로 센다 — 두 수가 갈리면 한 화면이 미배정을
     *   두 개의 수로 말한다. 이 화면 안에서는 한 공식만 쓴다.
     */
    unassignedCount: views.filter((member) => member.departmentIds.length === 0).length,
    reportingKnown: exceptions !== null,
  };
}
