import type { MemberSummaryRow } from "@/lib/auth/member-org-summary";
import {
  resolveReportsTo,
  type DepartmentNode,
  type ReportingContext,
} from "./reporting";

export type OrgDepartmentView = {
  id: string;
  parentId: string | null;
  name: string;
  key: string;
  headUserId: string | null;
  headName: string | null;
  /** 이 부서 직속(주부서 기준) 인원 수 — 하위 부서 미포함. */
  memberCount: number;
};

export type OrgPersonView = {
  userId: string;
  displayName: string;
  role: MemberSummaryRow["role"];
  deptId: string | null;
  deptName: string | null;
  isDeptHead: boolean;
  /** §1-3 으로 계산한 결과 — 저장값이 아니다. */
  reportsToUserId: string | null;
  reportsToName: string | null;
  /** 이 값이 있으면 위 reportsTo 는 트리 계산이 아니라 ①예외로 나온 것이다. */
  exceptionTargetUserId: string | null;
};

export type OrgChartState =
  | { kind: "unavailable" }
  | { kind: "error" }
  | {
      kind: "ready";
      ownerUserId: string;
      departments: OrgDepartmentView[];
      /** 부서가 없는 사람 — 미배정 풀(§1-2). 목록에서 사라지지 않는다. */
      unassigned: OrgPersonView[];
      people: OrgPersonView[];
      canEdit: boolean;
    };

type DepartmentRow = {
  id: unknown;
  parent_id: unknown;
  name: unknown;
  key: unknown;
  head_user_id: unknown;
  archived_at: unknown;
};

type MembershipRow = {
  dept_id: unknown;
  user_id: unknown;
  is_primary: unknown;
};

type ExceptionRow = {
  member_user_id: unknown;
  reports_to_user_id: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toDepartmentRow(value: unknown): { id: string; parentId: string | null; name: string; key: string; headUserId: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as DepartmentRow;
  const id = text(row.id);
  const name = text(row.name);
  const key = text(row.key);
  if (!id || !name || !key) return null;
  if (row.archived_at) return null;
  return { id, parentId: text(row.parent_id), name, key, headUserId: text(row.head_user_id) };
}

function toMembershipRow(value: unknown): { deptId: string; userId: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as MembershipRow;
  if (row.is_primary !== true) return null;
  const deptId = text(row.dept_id);
  const userId = text(row.user_id);
  return deptId && userId ? { deptId, userId } : null;
}

function toExceptionRow(value: unknown): { userId: string; targetUserId: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ExceptionRow;
  const userId = text(row.member_user_id);
  if (!userId) return null;
  return { userId, targetUserId: text(row.reports_to_user_id) };
}

/**
 * 화면 조립 — **순수 함수**(DB 접근 없음. 조회는 server.ts 가 맡는다).
 * Supabase 로우를 이미 읽었다는 전제로 부서 트리 + 사람별 계산된 보고 대상을 담은
 * 뷰모델을 만든다. entitlements 의 resolve.ts/server.ts 분리와 같은 이유로 나눴다 —
 * server.ts 는 "server-only" 를 import 해서 vitest 가 직접 못 돌린다.
 */
export function buildOrgChart(
  ownerUserId: string,
  allMembers: readonly MemberSummaryRow[],
  departmentRows: readonly unknown[],
  membershipRows: readonly unknown[],
  exceptionRows: readonly unknown[],
  canEdit: boolean,
): OrgChartState {
  const departments = departmentRows
    .map(toDepartmentRow)
    .filter((d): d is NonNullable<typeof d> => d !== null);
  const memberships = membershipRows
    .map(toMembershipRow)
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const exceptions = exceptionRows
    .map(toExceptionRow)
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const primaryDeptOf = new Map<string, string | null>(memberships.map((m) => [m.userId, m.deptId]));
  const exceptionOf = new Map<string, string | null>(exceptions.map((e) => [e.userId, e.targetUserId]));
  const nameOf = new Map(allMembers.map((m) => [m.userId, m.displayName]));

  const depNodes: DepartmentNode[] = departments.map((d) => ({
    id: d.id,
    parentId: d.parentId,
    headUserId: d.headUserId,
  }));
  const ctx: ReportingContext = { departments: depNodes, primaryDeptOf, exceptionOf, ownerUserId };

  const memberCountOf = new Map<string, number>();
  for (const m of memberships) memberCountOf.set(m.deptId, (memberCountOf.get(m.deptId) ?? 0) + 1);

  const departmentViews: OrgDepartmentView[] = departments
    .map((d) => ({
      id: d.id,
      parentId: d.parentId,
      name: d.name,
      key: d.key,
      headUserId: d.headUserId,
      headName: d.headUserId ? (nameOf.get(d.headUserId) ?? null) : null,
      memberCount: memberCountOf.get(d.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const deptNameOf = new Map(departmentViews.map((d) => [d.id, d.name]));

  const personView = (member: MemberSummaryRow): OrgPersonView => {
    const deptId = primaryDeptOf.get(member.userId) ?? null;
    const reportsToUserId = resolveReportsTo(member.userId, ctx);
    const exceptionTargetUserId = exceptionOf.get(member.userId) ?? null;
    return {
      userId: member.userId,
      displayName: member.displayName,
      role: member.role,
      deptId,
      deptName: deptId ? (deptNameOf.get(deptId) ?? null) : null,
      isDeptHead: deptId !== null && departmentViews.find((d) => d.id === deptId)?.headUserId === member.userId,
      reportsToUserId,
      reportsToName: reportsToUserId ? (nameOf.get(reportsToUserId) ?? null) : null,
      exceptionTargetUserId,
    };
  };

  const people = allMembers.map(personView);
  const unassigned = people.filter((p) => p.deptId === null);

  return { kind: "ready", ownerUserId, departments: departmentViews, unassigned, people, canEdit };
}
