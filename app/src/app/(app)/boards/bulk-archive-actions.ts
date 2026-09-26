"use server";

/**
 * 일괄 보관·보관복구 — 153 draft (휴지통과 별도).
 *
 *  - 보관해도 회사 원본·딜·원장 행을 삭제하지 않는다 (SQL이 items 한 행만 갱신).
 *  - 권한은 `work.item_delete` + `danger.bulk_edit_delete` (휴지통과 같은 가시성 파괴 등급).
 *  - 보호 RPC가 막히면 약한 경로로 fallback하지 않고 건별 명시 실패로 닫는다.
 *  - 건별 결과 — 부분 실패 시 입력·선택을 보존한다 (성공분만 선택에서 뺀다).
 *  - 영구삭제 없음.
 */

import { revalidatePath } from "next/cache";
import { requireBulkWritePermission } from "./bulk-permission";
import { createRequestBoards, requireRequestClient } from "@/lib/boards/server";
import { userFacingMessage } from "@/lib/boards/boardActionFlash";
import {
  ItemOperationError,
  archiveItemAtomic,
  deriveItemRequestId,
  newBulkKey,
  restoreArchivedItemAtomic,
} from "@/lib/boards/item-operations";
import { BULK_MAX_ITEMS } from "@/components/board/bulk-selection";

export type BulkArchiveItemResult = {
  itemId: string;
  ok: boolean;
  message: string;
};

export type BulkArchiveResult = {
  ok: boolean;
  applied: number;
  failed: number;
  results: BulkArchiveItemResult[];
};

export type BulkArchiveTarget = {
  id: string;
  expectedUpdatedAt?: string | null;
};

function allFailed(targets: readonly BulkArchiveTarget[], message: string): BulkArchiveResult {
  return {
    ok: false,
    applied: 0,
    failed: targets.length,
    results: targets.map((target) => ({ itemId: target.id, ok: false as const, message })),
  };
}

function toResult(
  processed: BulkArchiveItemResult[],
  skipped: readonly BulkArchiveTarget[],
  skipMessage: string,
): BulkArchiveResult {
  const results: BulkArchiveItemResult[] = [
    ...processed,
    ...skipped.map((target) => ({ itemId: target.id, ok: false as const, message: skipMessage })),
  ];
  const applied = results.filter((r) => r.ok).length;
  return { ok: applied > 0 && applied === results.length, applied, failed: results.length - applied, results };
}

function toMessage(error: unknown): string {
  if (error instanceof ItemOperationError) return error.message;
  return userFacingMessage(error);
}

function normalizeTargets(items: readonly (string | BulkArchiveTarget)[]): BulkArchiveTarget[] {
  const seen = new Set<string>();
  const out: BulkArchiveTarget[] = [];
  for (const entry of items) {
    const target = typeof entry === "string" ? { id: entry } : entry;
    if (!target.id || seen.has(target.id)) continue;
    seen.add(target.id);
    out.push(target);
  }
  return out;
}

const SYSTEM_BOARD_MESSAGE =
  "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다";

/**
 * 일괄 보관 — 휴지통과 별도로 치우고 보관 목록에서 복구한다.
 * `idempotencyKey` 를 같이 넘기면 실패분만 다시 실행해도 같은 requestId가 나가
 * RPC가 replay하고 중복 기록을 만들지 않는다.
 */
export async function bulkArchiveAction(input: {
  boardId: string;
  items: readonly (string | BulkArchiveTarget)[];
  idempotencyKey?: string;
}): Promise<BulkArchiveResult> {
  const targets = normalizeTargets(input.items);
  if (targets.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  const gate = await requireBulkWritePermission("work.item_delete");
  if (!gate.ok) return allFailed(targets, gate.message);

  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed(targets, userFacingMessage(error));
  }

  try {
    const detail = await graph.service.getBoardDetail(gate.ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed(targets, SYSTEM_BOARD_MESSAGE);
    }
  } catch (error) {
    return allFailed(targets, toMessage(error));
  }

  let client: ReturnType<typeof requireRequestClient>;
  try {
    client = requireRequestClient(graph.client, "일괄 보관");
  } catch (error) {
    return allFailed(targets, toMessage(error));
  }

  const bulkKey = input.idempotencyKey ?? newBulkKey();
  const head = targets.slice(0, BULK_MAX_ITEMS);
  const tail = targets.slice(BULK_MAX_ITEMS);
  const processed: BulkArchiveItemResult[] = [];
  for (const target of head) {
    try {
      await archiveItemAtomic(client, {
        orgId: gate.ctx.org.id,
        boardId: input.boardId,
        itemId: target.id,
        requestId: deriveItemRequestId(bulkKey, "archive", target.id),
        expectedUpdatedAt: target.expectedUpdatedAt ?? null,
      });
      processed.push({ itemId: target.id, ok: true, message: "보관했습니다. 보관 목록에서 복구할 수 있습니다." });
    } catch (error) {
      processed.push({ itemId: target.id, ok: false, message: toMessage(error) });
    }
  }
  if (processed.some((r) => r.ok)) revalidatePath(`/boards/${input.boardId}`);
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}

/** 일괄 보관복구 — 보관 성공분만 활성으로 되돌린다. */
export async function bulkRestoreArchivedAction(input: {
  boardId: string;
  items: readonly (string | BulkArchiveTarget)[];
  idempotencyKey?: string;
}): Promise<BulkArchiveResult> {
  const targets = normalizeTargets(input.items);
  if (targets.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  const gate = await requireBulkWritePermission("work.item_delete");
  if (!gate.ok) return allFailed(targets, gate.message);

  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed(targets, userFacingMessage(error));
  }

  try {
    const detail = await graph.service.getBoardDetail(gate.ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed(targets, SYSTEM_BOARD_MESSAGE);
    }
  } catch (error) {
    return allFailed(targets, toMessage(error));
  }

  let client: ReturnType<typeof requireRequestClient>;
  try {
    client = requireRequestClient(graph.client, "보관 복구");
  } catch (error) {
    return allFailed(targets, toMessage(error));
  }

  const bulkKey = input.idempotencyKey ?? newBulkKey();
  const head = targets.slice(0, BULK_MAX_ITEMS);
  const tail = targets.slice(BULK_MAX_ITEMS);
  const processed: BulkArchiveItemResult[] = [];
  for (const target of head) {
    try {
      await restoreArchivedItemAtomic(client, {
        orgId: gate.ctx.org.id,
        boardId: input.boardId,
        itemId: target.id,
        requestId: deriveItemRequestId(bulkKey, "restore-archived", target.id),
        expectedUpdatedAt: target.expectedUpdatedAt ?? null,
      });
      processed.push({ itemId: target.id, ok: true, message: "보관에서 복구했습니다." });
    } catch (error) {
      processed.push({ itemId: target.id, ok: false, message: toMessage(error) });
    }
  }
  if (processed.some((r) => r.ok)) revalidatePath(`/boards/${input.boardId}`);
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}
