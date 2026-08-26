"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { isManager } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export type DepartmentActionState = Readonly<{
  ok: boolean;
  message: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalUuid(formData: FormData, key: string): string | null | undefined {
  const value = field(formData, key);
  if (!value) return null;
  return UUID.test(value) ? value : undefined;
}

function failure(message: string): DepartmentActionState {
  return { ok: false, message };
}

function reason(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "").toLowerCase()
    : "";
  if (message.includes("manager required") || message.includes("permission")) {
    return "대표와 관리자만 조직도를 바꿀 수 있어요.";
  }
  if (message.includes("cycle")) return "하위 부서를 자기 상위로 옮길 수 없어요.";
  if (message.includes("active member")) return "현재 활동 중인 같은 회사 구성원만 배정할 수 있어요.";
  if (message.includes("department not found") || message.includes("parent")) {
    return "부서 구조가 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.";
  }
  return "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

async function managerClient() {
  const ctx = await getSession();
  if (!isManager(ctx.role)) return { ok: false as const, state: failure("대표와 관리자만 조직도를 바꿀 수 있어요.") };
  try {
    return { ok: true as const, ctx, client: await createClient() };
  } catch {
    return { ok: false as const, state: failure("서버 연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.") };
  }
}

function accepted(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { accepted?: unknown }).accepted === true;
}

function finish(message: string): DepartmentActionState {
  revalidatePath("/settings/members");
  return { ok: true, message };
}

export async function createDepartmentAction(formData: FormData): Promise<DepartmentActionState> {
  const name = field(formData, "name");
  const parentId = optionalUuid(formData, "parentId");
  if (!name || name.length > 80) return failure("부서 이름을 1~80자로 입력해 주세요.");
  if (parentId === undefined) return failure("상위 부서를 다시 선택해 주세요.");
  const access = await managerClient();
  if (!access.ok) return access.state;
  const { data, error } = await access.client.rpc("manage_org_department_create", {
    p_org_id: access.ctx.org.id,
    p_parent_id: parentId,
    p_name: name,
    p_request_id: randomUUID(),
  });
  if (error || !accepted(data)) return failure(reason(error));
  return finish("부서를 만들었어요.");
}

export async function renameDepartmentAction(formData: FormData): Promise<DepartmentActionState> {
  const departmentId = optionalUuid(formData, "departmentId");
  const name = field(formData, "name");
  if (!departmentId || departmentId === undefined || !name || name.length > 80) {
    return failure("부서 이름을 1~80자로 입력해 주세요.");
  }
  const access = await managerClient();
  if (!access.ok) return access.state;
  const { data, error } = await access.client.rpc("manage_org_department_rename", {
    p_org_id: access.ctx.org.id,
    p_dept_id: departmentId,
    p_name: name,
    p_request_id: randomUUID(),
  });
  if (error || !accepted(data)) return failure(reason(error));
  return finish("부서 이름을 바꿨어요.");
}

export async function moveDepartmentAction(formData: FormData): Promise<DepartmentActionState> {
  const departmentId = optionalUuid(formData, "departmentId");
  const parentId = optionalUuid(formData, "parentId");
  if (!departmentId || departmentId === undefined || parentId === undefined || departmentId === parentId) {
    return failure("상위 부서를 다시 선택해 주세요.");
  }
  const access = await managerClient();
  if (!access.ok) return access.state;
  const { data, error } = await access.client.rpc("manage_org_department_move", {
    p_org_id: access.ctx.org.id,
    p_dept_id: departmentId,
    p_new_parent_id: parentId,
    p_request_id: randomUUID(),
  });
  if (error || !accepted(data)) return failure(reason(error));
  return finish("상위 부서를 바꿨어요.");
}

export async function assignDepartmentMemberAction(formData: FormData): Promise<DepartmentActionState> {
  const userId = optionalUuid(formData, "userId");
  const departmentId = optionalUuid(formData, "departmentId");
  if (!userId || userId === undefined || departmentId === undefined) {
    return failure("구성원과 부서를 다시 선택해 주세요.");
  }
  const access = await managerClient();
  if (!access.ok) return access.state;
  const { data, error } = await access.client.rpc("manage_org_department_member", {
    p_org_id: access.ctx.org.id,
    p_user_id: userId,
    p_dept_id: departmentId,
    p_request_id: randomUUID(),
  });
  if (error || !accepted(data)) return failure(reason(error));
  return finish(departmentId ? "구성원의 주부서를 저장했어요." : "구성원을 미배정으로 옮겼어요.");
}
