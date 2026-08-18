"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createRequestBoards } from "@/lib/boards/server";
import { loadPermGuard } from "@/lib/perm/guard";
import type { Ctx } from "@/lib/types";
// ★ 상태 모양은 순수 모듈에 있다. "use server" 파일은 async 함수 외에는 export 할 수 없고,
//   여기서 re-export 만 해도 같은 이유로 터진다. 화면 쪽은 그 파일에서 직접 가져간다.
import type { TrashActionState } from "./trash-action-state";


async function requirePermission(ctx: Ctx): Promise<void> {
  const permission = await loadPermGuard(ctx.org.id, "work.item_delete");
  if (permission.kind !== "allowed") {
    throw new Error(permission.reason === "permission"
      ? "이 항목을 삭제하거나 복구할 권한이 없습니다."
      : "권한을 확인하지 못했습니다.");
  }
}

function required(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error("요청 정보가 올바르지 않습니다.");
  return value;
}

function failure(error: unknown): TrashActionState {
  return {
    ok: false,
    message: error instanceof Error && error.message
      ? error.message
      : "항목을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };
}

export async function trashItemAction(
  _previous: TrashActionState,
  formData: FormData,
): Promise<TrashActionState> {
  try {
    const ctx = await getSession();
    await requirePermission(ctx);
    const boardId = required(formData, "boardId");
    const itemId = required(formData, "itemId");
    const { service } = await createRequestBoards();
    await service.deleteItem(ctx, boardId, itemId);
    revalidatePath(`/boards/${boardId}`);
    return { ok: true, message: "항목을 휴지통으로 옮겼습니다." };
  } catch (error) {
    return failure(error);
  }
}

export async function restoreItemAction(
  _previous: TrashActionState,
  formData: FormData,
): Promise<TrashActionState> {
  try {
    const ctx = await getSession();
    await requirePermission(ctx);
    const boardId = required(formData, "boardId");
    const itemId = required(formData, "itemId");
    const { service } = await createRequestBoards();
    await service.restoreItem(ctx, boardId, itemId);
    revalidatePath(`/boards/${boardId}`);
    return { ok: true, message: "항목을 원래 위치로 복구했습니다." };
  } catch (error) {
    return failure(error);
  }
}
