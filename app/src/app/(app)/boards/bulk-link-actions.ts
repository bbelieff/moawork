"use server";

/**
 * 일괄 상하위 연결/해제 — 153 draft `set_board_item_parent_atomic`.
 *
 *  - 같은 조직·같은 보드만, 자기참조·순환 거부, 부모는 활성 행이어야 한다.
 *  - 부모 선택이 하위를 암묵적으로 일괄수정/삭제하지 않는다 —
 *    자식 한 행의 `parent_item_id` 만 바꾸고, 대상 미리보기는 호출부(UI)가 보여준다.
 *  - 권한은 `work.item_upsert` + `danger.bulk_edit_delete`.
 *  - 보호 RPC가 막히면 약한 경로로 fallback하지 않고 건별 명시 실패로 닫는다.
 */

import { revalidatePath } from "next/cache";
import { requireBulkWritePermission } from "./bulk-permission";
import { createRequestBoards, requireRequestClient } from "@/lib/boards/server";
import { userFacingMessage } from "@/lib/boards/boardActionFlash";
import { ItemOperationError, deriveItemRequestId, newBulkKey, setItemParentAtomic } from "@/lib/boards/item-operations";
import { BULK_MAX_ITEMS } from "@/components/board/bulk-selection";

export type BulkLinkItemResult = {
  itemId: string;
  ok: boolean;
  message: string;
};

export type BulkLinkResult = {
  ok: boolean;
  applied: number;
  failed: number;
  results: BulkLinkItemResult[];
};

export type BulkLinkTarget = {
  id: string;
  expectedUpdatedAt?: string | null;
};

function allFailed(targets: readonly BulkLinkTarget[], message: string): BulkLinkResult {
  return {
    ok: false,
    applied: 0,
    failed: targets.length,
    results: targets.map((target) => ({ itemId: target.id, ok: false as const, message })),
  };
}

function toResult(
  processed: BulkLinkItemResult[],
  skipped: readonly BulkLinkTarget[],
  skipMessage: string,
): BulkLinkResult {
  const results: BulkLinkItemResult[] = [
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

function normalizeTargets(items: readonly (string | BulkLinkTarget)[]): BulkLinkTarget[] {
  const seen = new Set<string>();
  const out: BulkLinkTarget[] = [];
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
 * 일괄 상하위 연결/해제 — 선택한 행 전체에 같은 부모를 연결한다.
 * `parentItemId` 가 null이면 연결 해제다. 부모 자신·순환·다른 보드 부모는 건별 실패.
 */
export async function bulkSetParentAction(input: {
  boardId: string;
  items: readonly (string | BulkLinkTarget)[];
  parentItemId: string | null;
  idempotencyKey?: string;
}): Promise<BulkLinkResult> {
  const targets = normalizeTargets(input.items).filter((target) => target.id !== input.parentItemId);
  const selfSkipped = normalizeTargets(input.items).filter((target) => target.id === input.parentItemId);
  if (targets.length === 0) {
    return {
      ok: false,
      applied: 0,
      failed: selfSkipped.length,
      results: selfSkipped.map((target) => ({ itemId: target.id, ok: false as const, message: "자기 자신을 부모로 연결할 수 없습니다." })),
    };
  }

  const gate = await requireBulkWritePermission("work.item_upsert");
  if (!gate.ok) return allFailed([...targets, ...selfSkipped], gate.message);

  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed([...targets, ...selfSkipped], userFacingMessage(error));
  }

  try {
    const detail = await graph.service.getBoardDetail(gate.ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed([...targets, ...selfSkipped], SYSTEM_BOARD_MESSAGE);
    }
  } catch (error) {
    return allFailed([...targets, ...selfSkipped], toMessage(error));
  }

  let client: ReturnType<typeof requireRequestClient>;
  try {
    client = requireRequestClient(graph.client, "상하위 연결");
  } catch (error) {
    return allFailed([...targets, ...selfSkipped], toMessage(error));
  }

  const bulkKey = input.idempotencyKey ?? newBulkKey();
  const head = targets.slice(0, BULK_MAX_ITEMS);
  const tail = targets.slice(BULK_MAX_ITEMS);
  const doneMessage = input.parentItemId === null ? "상위 연결을 해제했습니다." : "상위 항목을 연결했습니다.";
  const processed: BulkLinkItemResult[] = [];
  for (const target of head) {
    try {
      await setItemParentAtomic(client, {
        orgId: gate.ctx.org.id,
        boardId: input.boardId,
        itemId: target.id,
        parentItemId: input.parentItemId,
        requestId: deriveItemRequestId(bulkKey, "set-parent", `${target.id}:${input.parentItemId ?? ""}`),
        expectedUpdatedAt: target.expectedUpdatedAt ?? null,
      });
      processed.push({ itemId: target.id, ok: true, message: doneMessage });
    } catch (error) {
      processed.push({ itemId: target.id, ok: false, message: toMessage(error) });
    }
  }
  if (processed.some((r) => r.ok)) revalidatePath(`/boards/${input.boardId}`);
  return toResult(
    [
      ...processed,
      ...selfSkipped.map((target) => ({ itemId: target.id, ok: false as const, message: "자기 자신을 부모로 연결할 수 없습니다." })),
    ],
    tail,
    `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`,
  );
}
