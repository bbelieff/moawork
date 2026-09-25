"use server";

/**
 * 일괄 휴지통·복구 — agenda06 승인된 소규모 작업.
 *
 * 기존 단일 경로를 그대로 재사용한다:
 *  - `BoardsService.deleteItem/restoreItem` (board/item association/system/scopes는 서비스·repo·RLS가 강제)
 *  - 권한은 `work.item_delete` (trash-actions.ts와 동일 게이트)
 *  - 하드 삭제 없음 — delete는 deleted_at 소프트, restore는 원위치 복구.
 *
 * 안전 규칙:
 *  - 시스템 보드는 쓰기 전에 거부 (서비스도 막지만 여기서 먼저 구조적 실패로 닫는다).
 *  - 건별 결과 — 부분 실패 시 입력·선택을 보존한다 (성공분만 선택에서 뺀다, 호출부가 onApplied로 처리).
 *  - 되돌리기는 성공한 ID만 원래 보드로 (호출부가 successful IDs를 들고 restore를 부른다).
 *  - 실제 데이터 테스트 없음 — 검증은 모킹된 서비스로만 한다.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createRequestBoards } from "@/lib/boards/server";
import { userFacingMessage } from "@/lib/boards/boardActionFlash";
import { BULK_MAX_ITEMS } from "@/components/board/bulk-selection";

export type BulkTrashItemResult = {
  itemId: string;
  ok: boolean;
  message: string;
};

export type BulkTrashResult = {
  ok: boolean;
  applied: number;
  failed: number;
  results: BulkTrashItemResult[];
};

function allFailed(itemIds: readonly string[], message: string): BulkTrashResult {
  return {
    ok: false,
    applied: 0,
    failed: itemIds.length,
    results: itemIds.map((itemId) => ({ itemId, ok: false as const, message })),
  };
}

function toResult(
  processed: BulkTrashItemResult[],
  skipped: readonly string[],
  skipMessage: string,
): BulkTrashResult {
  const results: BulkTrashItemResult[] = [
    ...processed,
    ...skipped.map((itemId) => ({ itemId, ok: false as const, message: skipMessage })),
  ];
  const applied = results.filter((r) => r.ok).length;
  return { ok: applied > 0 && applied === results.length, applied, failed: results.length - applied, results };
}

async function requireTrashPermission(): Promise<{ ok: true; ctx: Awaited<ReturnType<typeof getSession>> } | { ok: false; message: string }> {
  try {
    const ctx = await getSession();
    const permission = await loadPermGuard(ctx.org.id, "work.item_delete");
    if (permission.kind !== "allowed") {
      return {
        ok: false,
        message:
          permission.reason === "permission"
            ? "이 항목을 삭제하거나 복구할 권한이 없어요."
            : "권한을 확인하지 못했어요.",
      };
    }
    return { ok: true, ctx };
  } catch (error) {
    return { ok: false, message: userFacingMessage(error) };
  }
}

const SYSTEM_BOARD_MESSAGE =
  "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다";

/** 일괄 휴지통 — 선택한 행을 복구 가능하게 치운다 (하드 삭제 없음). */
export async function bulkTrashAction(input: {
  boardId: string;
  itemIds: string[];
}): Promise<BulkTrashResult> {
  const ids = [...new Set(input.itemIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  const gate = await requireTrashPermission();
  if (!gate.ok) return allFailed(ids, gate.message);

  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  try {
    const detail = await graph.service.getBoardDetail(gate.ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed(ids, SYSTEM_BOARD_MESSAGE);
    }
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  const processed: BulkTrashItemResult[] = [];
  for (const itemId of head) {
    try {
      await graph.service.deleteItem(gate.ctx, input.boardId, itemId);
      processed.push({ itemId, ok: true, message: "휴지통으로 옮겼습니다." });
    } catch (error) {
      processed.push({ itemId, ok: false, message: userFacingMessage(error) });
    }
  }
  if (processed.some((r) => r.ok)) revalidatePath(`/boards/${input.boardId}`);
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}

/** 일괄 복구 — 휴지통 성공분만 원래 보드로 되돌린다. */
export async function bulkRestoreAction(input: {
  boardId: string;
  itemIds: string[];
}): Promise<BulkTrashResult> {
  const ids = [...new Set(input.itemIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  const gate = await requireTrashPermission();
  if (!gate.ok) return allFailed(ids, gate.message);

  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  try {
    const detail = await graph.service.getBoardDetail(gate.ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed(ids, SYSTEM_BOARD_MESSAGE);
    }
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  const processed: BulkTrashItemResult[] = [];
  for (const itemId of head) {
    try {
      await graph.service.restoreItem(gate.ctx, input.boardId, itemId);
      processed.push({ itemId, ok: true, message: "복구했습니다." });
    } catch (error) {
      processed.push({ itemId, ok: false, message: userFacingMessage(error) });
    }
  }
  if (processed.some((r) => r.ok)) revalidatePath(`/boards/${input.boardId}`);
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}
