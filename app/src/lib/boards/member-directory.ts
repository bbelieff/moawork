import type { DefaultTabAssignee } from "@/lib/default-tabs/types";
import type { DepartmentNode, OrgChart } from "@/lib/org/departments";

export interface MemberDirectoryPickerEntry {
  id: string;
  label: string;
  avatarUrl: string | null;
  title?: string | null;
  groupId: string | null;
  groupLabel: string;
  active: boolean;
}

/** MemberPicker는 같은 user id가 여러 부서에 나타나도 저장 시 user id 하나로 합친다. */
export function memberPickerEntries(chart: Extract<OrgChart, { kind: "ready" }>): MemberDirectoryPickerEntry[] {
  const departmentById = new Map(chart.departments.map((department) => [department.id, department]));
  return chart.members.flatMap((member) => {
    const departments = member.departmentIds
      .map((id) => departmentById.get(id))
      .filter((entry): entry is DepartmentNode => Boolean(entry));
    const bases = departments.length > 0 ? departments : [null];
    return bases.map((department) => ({
      id: member.userId,
      label: member.displayName,
      avatarUrl: member.avatarUrl,
      title: null,
      groupId: department?.id ?? null,
      groupLabel: department?.name ?? "부서 미지정",
      active: member.active,
    }));
  });
}

/** 조직도가 아직 없는 로컬 fixture와 읽기 실패 때만 쓰는 정직한 fallback. */
export function legacyMemberPickerEntries(assignees: readonly DefaultTabAssignee[]): MemberDirectoryPickerEntry[] {
  return assignees.map((member) => ({
    id: member.userId,
    label: member.displayName,
    avatarUrl: null,
    title: member.title ?? null,
    groupId: null,
    groupLabel: "부서 미지정",
    active: true,
  }));
}
