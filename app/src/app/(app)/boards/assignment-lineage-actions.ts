"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import {
  AssignmentLineageService,
  AssignmentLineageUnavailableError,
  SupabaseAssignmentLineageRepo,
  type AssignmentLineageSnapshot,
} from "@/lib/assignment-lineage";
import { createClient } from "@/lib/supabase/server";

export type AssignmentLineageRef = Readonly<{
  boardId: string;
  dealId: string;
  itemId: string;
}>;

export type AssignmentLineageActionErrorCode =
  | "conflict"
  | "permission"
  | "request_mismatch"
  | "unavailable";

export type AssignmentLineageActionResult<T = undefined> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; code: AssignmentLineageActionErrorCode; error: string }>;

type ReassignInput = AssignmentLineageRef & Readonly<{
  assignedTo: string | null;
  expectedAssignedTo: string | null;
  expectedVersion: number;
  requestId: string;
}>;

type FollowerInput = AssignmentLineageRef & Readonly<{
  userId: string;
  follow: boolean;
  requestId: string;
}>;

type ScheduleInput = AssignmentLineageRef & Readonly<{
  toUserId: string;
  expectedAssignedTo: string | null;
  expectedVersion: number;
  requestId: string;
}>;

type CancelInput = AssignmentLineageRef & Readonly<{
  handoffId: string;
  requestId: string;
}>;

function validRef(input: AssignmentLineageRef): boolean {
  return Boolean(input.boardId && input.dealId && input.itemId);
}

function failure(error: unknown, read = false): AssignmentLineageActionResult<never> {
  const code = error instanceof AssignmentLineageUnavailableError ? error.code : undefined;
  if (code === "40001") {
    return { ok: false, code: "conflict", error: "담당자 정보가 먼저 변경되었습니다. 새로 불러온 뒤 다시 시도해 주세요." };
  }
  if (code === "42501") {
    return { ok: false, code: "permission", error: read ? "이 담당자 흐름을 볼 수 없습니다." : "이 담당자 흐름을 변경할 권한이 없습니다." };
  }
  if (code === "22023") {
    return { ok: false, code: "request_mismatch", error: "이전 요청과 내용이 달라 처리할 수 없습니다. 선택을 확인해 주세요." };
  }
  return { ok: false, code: "unavailable", error: read ? "담당자 흐름을 불러오지 못했습니다. 다시 시도해 주세요." : "담당자 흐름을 저장하지 못했습니다. 같은 요청으로 다시 시도해 주세요." };
}

async function context() {
  const session = await getSession();
  const service = new AssignmentLineageService(
    new SupabaseAssignmentLineageRepo(await createClient()),
  );
  return {
    actor: { orgId: session.org.id, userId: session.user.id },
    service,
  };
}

function refresh(boardId: string) {
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/newcust");
}

export async function readAssignmentLineageAction(
  input: AssignmentLineageRef,
): Promise<AssignmentLineageActionResult<AssignmentLineageSnapshot>> {
  if (!validRef(input)) return { ok: false, code: "unavailable", error: "담당자 흐름 대상을 확인해 주세요." };
  try {
    const { actor, service } = await context();
    return { ok: true, data: await service.read(actor, input) };
  } catch (error) {
    return failure(error, true);
  }
}

export async function reassignAssignmentAction(
  input: ReassignInput,
): Promise<AssignmentLineageActionResult<{ version: number }>> {
  if (!validRef(input) || !input.requestId || input.expectedVersion < 0) {
    return { ok: false, code: "unavailable", error: "담당자 변경 요청을 확인해 주세요." };
  }
  try {
    const { actor, service } = await context();
    const result = await service.reassign(actor, input);
    refresh(input.boardId);
    return { ok: true, data: { version: result.version } };
  } catch (error) {
    return failure(error);
  }
}

export async function setAssignmentFollowerAction(
  input: FollowerInput,
): Promise<AssignmentLineageActionResult<{ version: number }>> {
  if (!validRef(input) || !input.userId || !input.requestId) {
    return { ok: false, code: "unavailable", error: "알림 대상 요청을 확인해 주세요." };
  }
  try {
    const { actor, service } = await context();
    const result = await service.setFollower(actor, input);
    refresh(input.boardId);
    return { ok: true, data: { version: result.version } };
  } catch (error) {
    return failure(error);
  }
}

export async function scheduleAssignmentHandoffAction(
  input: ScheduleInput,
): Promise<AssignmentLineageActionResult<{ version: number; handoffId?: string }>> {
  if (!validRef(input) || !input.toUserId || !input.requestId || input.expectedVersion < 0) {
    return { ok: false, code: "unavailable", error: "인계 예정 요청을 확인해 주세요." };
  }
  try {
    const { actor, service } = await context();
    const result = await service.scheduleHandoff(actor, input);
    refresh(input.boardId);
    return { ok: true, data: { version: result.version, handoffId: result.handoffId } };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelAssignmentHandoffAction(
  input: CancelInput,
): Promise<AssignmentLineageActionResult<{ version: number }>> {
  if (!validRef(input) || !input.handoffId || !input.requestId) {
    return { ok: false, code: "unavailable", error: "취소할 인계 예정 정보를 확인해 주세요." };
  }
  try {
    const { actor, service } = await context();
    const result = await service.cancelHandoff(actor, input);
    refresh(input.boardId);
    return { ok: true, data: { version: result.version } };
  } catch (error) {
    return failure(error);
  }
}
