"use server";

import { after } from "next/server";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createRequestBoards } from "@/lib/boards/server";
import { writeBoardCell } from "@/lib/boards/cell-save";
import { UserFacingActionError, userFacingMessage } from "@/lib/boards/boardActionFlash";
import type { CellSaveResult } from "@/lib/boards/cell-save-result";
import { notifyBoardItemMoved } from "@/lib/notify/board-actions";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

/** 화면 전체 새로 그리기를 거쳐야 하는 칸 — 파일 올리기와 컨택 이동(다른 탭으로 보냄). */
function needsFullRender(columnKey: string, raw: FormDataEntryValue | null): boolean {
  return raw instanceof File
    || (columnKey === "contact_move" && raw === "컨택 이동")
    || (columnKey === "consult_status" && raw === "리드컨택으로 넘기기");
}

/**
 * 셀 인라인 저장 — 결과만 돌려준다(Issue 857).
 *
 * `setCellAction` 은 저장 뒤 revalidatePath 와 플래시 쿠키로 화면을 처음부터 다시 그려서
 * 값이 바뀌어 보이기까지 3~5초가 걸렸다. 여기서는 그 둘을 하지 않고, 화면이 돌려받은 행으로
 * 그 줄만 고친다. 검증·권한·저장 본체는 같다(writeBoardCell). 상태 이동 알림은 응답 뒤에 보낸다.
 */
export async function saveCellValueAction(formData: FormData): Promise<CellSaveResult> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  const itemId = str(formData, "itemId");
  const columnKey = str(formData, "columnKey");
  try {
    if (needsFullRender(columnKey, formData.get("value"))) {
      throw new UserFacingActionError("이 칸은 화면을 새로 고친 뒤 다시 저장해 주세요.");
    }
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") {
      throw new UserFacingActionError(
        permission.reason === "permission" ? "이 업무를 실행할 권한이 없어요." : "권한을 확인하지 못했어요.",
      );
    }
    const graph = await createRequestBoards();
    const { saved, changedColumn } = await writeBoardCell(ctx, graph, { boardId, itemId, columnKey, formData });
    const client = graph.client;
    if (client && saved.errors.length === 0 && changedColumn?.type === "status") {
      after(async () => {
        try {
          await notifyBoardItemMoved(client, ctx, { boardId, itemId, eventKey: crypto.randomUUID() });
        } catch (notificationError) {
          // 셀 저장은 이미 커밋됐다. 알림 부작용 실패를 저장 실패로 거짓 표시하지 않는다.
          console.warn("[board status notification]", boardId, itemId, notificationError);
        }
      });
    }
    return { ok: true, item: saved.item, errors: saved.errors, notices: saved.notices ?? [] };
  } catch (error) {
    console.error("[board cell]", boardId, itemId, columnKey, error);
    return { ok: false, errors: [{ key: columnKey, label: columnKey, message: userFacingMessage(error) }] };
  }
}
