"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { createRequestBoards } from "@/lib/boards/server";
import { loadPermGuard } from "@/lib/perm/guard";
import {
  BOARD_ACTION_FLASH_COOKIE,
  BOARD_ACTION_FLASH_MAX_AGE,
  encodeBoardActionFlash,
  UserFacingActionError,
  userFacingMessage,
} from "@/lib/boards/boardActionFlash";

function required(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error("복구 요청 정보가 올바르지 않습니다.");
  return value;
}

export async function restoreColumnAction(boundBoardId: string, formData: FormData): Promise<void> {
  const boardId = boundBoardId.trim();
  if (!boardId) return;
  const jar = await cookies();
  jar.set(BOARD_ACTION_FLASH_COOKIE, "", { path: "/", maxAge: 0 });
  try {
    const ctx = await getSession();
    const permission = await loadPermGuard(ctx.org.id, "structure.column_manage");
    if (permission.kind !== "allowed") {
      throw new UserFacingActionError(
        permission.reason === "permission" ? "컬럼을 복구할 권한이 없어요." : "권한을 확인하지 못했어요.",
      );
    }
    const columnId = required(formData, "columnId");
    const { service } = await createRequestBoards();
    await service.restoreColumn(ctx, boardId, columnId);
  } catch (error) {
    console.error("[column restore]", boardId, error);
    const encoded = encodeBoardActionFlash({ boardId, message: userFacingMessage(error) });
    if (encoded) {
      jar.set(BOARD_ACTION_FLASH_COOKIE, encoded, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: BOARD_ACTION_FLASH_MAX_AGE,
      });
    }
  }
  revalidatePath(`/boards/${boardId}`);
}
