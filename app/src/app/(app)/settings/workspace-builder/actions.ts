"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createRequestBoards } from "@/lib/boards/server";
import { loadPermGuard } from "@/lib/perm/guard";

export type WorkflowStructureResult = Readonly<{ ok: boolean; message: string }>;

async function editableRuntime(boardId: string): Promise<
  | { result: WorkflowStructureResult }
  | {
      ctx: Awaited<ReturnType<typeof getSession>>;
      service: Awaited<ReturnType<typeof createRequestBoards>>["service"];
    }
> {
  const ctx = await getSession();
  const guard = await loadPermGuard(ctx.org.id, "structure.section_manage");
  if (guard.kind !== "allowed") {
    return {
      result: {
        ok: false,
        message: guard.reason === "permission"
          ? "업무 단계를 편집할 권한이 없습니다."
          : "권한을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      },
    };
  }
  const runtime = await createRequestBoards();
  await runtime.service.getBoardDetail(ctx, boardId);
  return { ctx, service: runtime.service };
}

export async function renameWorkflowGroupAction(
  boardId: string,
  groupId: string,
  name: string,
): Promise<WorkflowStructureResult> {
  try {
    const clean = name.trim();
    if (!clean) return { ok: false, message: "단계 이름을 입력해 주세요." };
    const runtime = await editableRuntime(boardId);
    if ("result" in runtime) return runtime.result;
    await runtime.service.renameGroup(runtime.ctx, boardId, groupId, clean);
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/settings/workspace-builder");
    return { ok: true, message: `«${clean}» 단계 이름을 저장했습니다.` };
  } catch {
    return { ok: false, message: "단계 이름을 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요." };
  }
}

export async function reorderWorkflowGroupsAction(
  boardId: string,
  groupIds: readonly string[],
): Promise<WorkflowStructureResult> {
  try {
    if (groupIds.length === 0 || groupIds.some((id) => !id)) {
      return { ok: false, message: "저장할 단계 순서를 읽지 못했습니다." };
    }
    const runtime = await editableRuntime(boardId);
    if ("result" in runtime) return runtime.result;
    await runtime.service.reorderGroups(runtime.ctx, boardId, groupIds);
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/settings/workspace-builder");
    return { ok: true, message: "탭 안 단계 순서를 저장했습니다." };
  } catch {
    return { ok: false, message: "단계 순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요." };
  }
}
