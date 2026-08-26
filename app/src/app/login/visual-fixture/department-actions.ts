"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { DepartmentActionState } from "@/app/(app)/settings/members/department-actions";
import type { OrgChart } from "@/lib/org/departments";

const COOKIE = "visual-department-state";
const MEMBER_A = "70000000-0000-4000-8000-000000000001";
const MEMBER_B = "70000000-0000-4000-8000-000000000002";

type VisualDepartment = { id: string; name: string; parentId: string | null; sortOrder: number };
type VisualState = { departments: VisualDepartment[]; assignments: Record<string, string> };

async function read(): Promise<VisualState> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return { departments: [], assignments: {} };
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as VisualState;
    return Array.isArray(parsed.departments) && parsed.assignments && typeof parsed.assignments === "object"
      ? parsed
      : { departments: [], assignments: {} };
  } catch {
    return { departments: [], assignments: {} };
  }
}

async function write(state: VisualState) {
  (await cookies()).set(COOKIE, encodeURIComponent(JSON.stringify(state)), { httpOnly: true, sameSite: "lax", path: "/login/visual-fixture" });
  revalidatePath("/login/visual-fixture");
}

function value(formData: FormData, key: string): string {
  const candidate = formData.get(key);
  return typeof candidate === "string" ? candidate.trim() : "";
}

const ok = (message: string): DepartmentActionState => ({ ok: true, message });
const bad = (message: string): DepartmentActionState => ({ ok: false, message });

export async function loadVisualDepartmentChart(): Promise<OrgChart> {
  const state = await read();
  const members = [
    { userId: MEMBER_A, displayName: "가상 관리자", avatarUrl: null, departmentIds: state.assignments[MEMBER_A] ? [state.assignments[MEMBER_A]] : [], primaryDepartmentId: state.assignments[MEMBER_A] ?? null, active: true },
    { userId: MEMBER_B, displayName: "가상 구성원", avatarUrl: null, departmentIds: state.assignments[MEMBER_B] ? [state.assignments[MEMBER_B]] : [], primaryDepartmentId: state.assignments[MEMBER_B] ?? null, active: true },
  ];
  return {
    kind: "ready",
    departments: state.departments.map((department) => ({
      ...department,
      headUserId: null,
      memberCount: members.filter((member) => member.departmentIds.includes(department.id)).length,
    })),
    members,
    unassignedCount: members.filter((member) => member.departmentIds.length === 0).length,
  };
}

export async function visualCreateDepartmentAction(formData: FormData): Promise<DepartmentActionState> {
  const name = value(formData, "name");
  const parentId = value(formData, "parentId") || null;
  if (!name) return bad("부서 이름을 입력해 주세요.");
  const state = await read();
  if (parentId && !state.departments.some((department) => department.id === parentId)) return bad("상위 부서를 다시 선택해 주세요.");
  state.departments.push({ id: randomUUID(), name, parentId, sortOrder: state.departments.length });
  await write(state);
  return ok("부서를 만들었어요.");
}

export async function visualRenameDepartmentAction(formData: FormData): Promise<DepartmentActionState> {
  const id = value(formData, "departmentId");
  const name = value(formData, "name");
  const state = await read();
  const department = state.departments.find((entry) => entry.id === id);
  if (!department || !name) return bad("부서 이름을 다시 확인해 주세요.");
  department.name = name;
  await write(state);
  return ok("부서 이름을 바꿨어요.");
}

export async function visualMoveDepartmentAction(formData: FormData): Promise<DepartmentActionState> {
  const id = value(formData, "departmentId");
  const parentId = value(formData, "parentId") || null;
  const state = await read();
  const department = state.departments.find((entry) => entry.id === id);
  if (!department || parentId === id || parentId && !state.departments.some((entry) => entry.id === parentId)) return bad("상위 부서를 다시 선택해 주세요.");
  department.parentId = parentId;
  await write(state);
  return ok("상위 부서를 바꿨어요.");
}

export async function visualAssignDepartmentMemberAction(formData: FormData): Promise<DepartmentActionState> {
  const userId = value(formData, "userId");
  const departmentId = value(formData, "departmentId");
  if (![MEMBER_A, MEMBER_B].includes(userId)) return bad("구성원을 다시 선택해 주세요.");
  const state = await read();
  if (departmentId && !state.departments.some((department) => department.id === departmentId)) return bad("부서를 다시 선택해 주세요.");
  if (departmentId) state.assignments[userId] = departmentId;
  else delete state.assignments[userId];
  await write(state);
  return ok(departmentId ? "구성원의 주부서를 저장했어요." : "구성원의 주부서 지정을 해제했어요.");
}
