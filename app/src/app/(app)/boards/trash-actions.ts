"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createRequestBoards } from "@/lib/boards/server";
import { loadPermGuard } from "@/lib/perm/guard";
import { canTrashOwnRow } from "@/lib/boards/own-row";
import type { Ctx } from "@/lib/types";
// ★ 상태 모양은 순수 모듈에 있다. "use server" 파일은 async 함수 외에는 export 할 수 없고,
//   여기서 re-export 만 해도 같은 이유로 터진다. 화면 쪽은 그 파일에서 직접 가져간다.
import type { TrashActionState } from "./trash-action-state";


type RequestBoards = Awaited<ReturnType<typeof createRequestBoards>>;

/** 휴지통에 든 행도 담당자를 읽는다(되살리기). 로컬 모드는 살아 있는 행만 읽는다. */
function assigneeReader(ctx: Ctx, graph: RequestBoards, boardId: string) {
  return async (itemId: string) => {
    if (graph.client) {
      const { data, error } = await graph.client.from("items").select("assigned_to")
        .eq("org_id", ctx.org.id).eq("board_id", boardId).eq("id", itemId).maybeSingle();
      if (error) throw error;
      return (data as { assigned_to: string | null } | null)?.assigned_to ?? null;
    }
    return (await graph.service.getItem(ctx, boardId, itemId)).assigned_to;
  };
}

async function requirePermission(ctx: Ctx, own?: { graph: RequestBoards; boardId: string; itemId: string }): Promise<void> {
  const permission = await loadPermGuard(ctx.org.id, "work.item_delete");
  // QA #883 — 자기가 맡은 행은 «항목 삭제» 권한 없이도 휴지통에 넣고 되살린다(lib/boards/own-row.ts).
  if (permission.kind !== "allowed" && own
    && await canTrashOwnRow(ctx, assigneeReader(ctx, own.graph, own.boardId), own.itemId)) return;
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
    const boardId = required(formData, "boardId");
    const itemId = required(formData, "itemId");
    const graph = await createRequestBoards();
    await requirePermission(ctx, { graph, boardId, itemId });
    const { service } = graph;
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
    const boardId = required(formData, "boardId");
    const itemId = required(formData, "itemId");
    const graph = await createRequestBoards();
    await requirePermission(ctx, { graph, boardId, itemId });
    const { service } = graph;
    await service.restoreItem(ctx, boardId, itemId);
    revalidatePath(`/boards/${boardId}`);
    return { ok: true, message: "항목을 원래 위치로 복구했습니다." };
  } catch (error) {
    return failure(error);
  }
}
