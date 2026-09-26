"use server";

/**
 * 일괄 안전 복제 — 단순 JSON 복사 금지.
 *
 *  - 일반 보드: `duplicate_board_item_atomic` — 새 item ID를 원자 생성하고
 *    허용된 입력값만 복사한다. 회사 정체성은 같은 org로 유지되고,
 *    deal 연결·담당자·부모·삭제/보관 상태는 복사하지 않는다.
 *  - 정본 딜 계열 보드(신규리드·연락·계약업무):
 *    `duplicate_canonical_deal_item_atomic` 단일 트랜잭션으로 새 deal/item을
 *    만들고 출처까지 기록한다. 회사 식별자는 새로 만들지 않고 원본 deal의
 *    company_id를 그대로 물린다. 담당자는 복사하지 않고 행위자로 둔다.
 *    두 단계(create 후 link 기록)가 아니라 한 번의 호출이므로
 *    lost-response 재시도가 중복 행을 만들지 않는다.
 *  - 권한은 `work.item_upsert` + `danger.bulk_edit_delete`.
 *  - 보호 RPC가 막히면 약한 경로로 fallback하지 않고 건별 명시 실패로 닫는다.
 *  - 이번 영구삭제 없음.
 */

import { revalidatePath } from "next/cache";
import { requireBulkWritePermission } from "./bulk-permission";
import { createRequestBoards, requireRequestClient } from "@/lib/boards/server";
import { userFacingMessage } from "@/lib/boards/boardActionFlash";
import {
  ItemOperationError,
  deriveItemRequestId,
  duplicateCanonicalDealItemAtomic,
  duplicateItemAtomic,
  newBulkKey,
  requiresCanonicalDuplicate,
} from "@/lib/boards/item-operations";
import { BULK_MAX_ITEMS } from "@/components/board/bulk-selection";

export type BulkDuplicateItemResult = {
  itemId: string;
  newItemId: string | null;
  ok: boolean;
  message: string;
};

export type BulkDuplicateResult = {
  ok: boolean;
  applied: number;
  failed: number;
  results: BulkDuplicateItemResult[];
};

function allFailed(itemIds: readonly string[], message: string): BulkDuplicateResult {
  return {
    ok: false,
    applied: 0,
    failed: itemIds.length,
    results: itemIds.map((itemId) => ({ itemId, newItemId: null, ok: false as const, message })),
  };
}

function toResult(
  processed: BulkDuplicateItemResult[],
  skipped: readonly string[],
  skipMessage: string,
): BulkDuplicateResult {
  const results: BulkDuplicateItemResult[] = [
    ...processed,
    ...skipped.map((itemId) => ({ itemId, newItemId: null, ok: false as const, message: skipMessage })),
  ];
  const applied = results.filter((r) => r.ok).length;
  return { ok: applied > 0 && applied === results.length, applied, failed: results.length - applied, results };
}

function toMessage(error: unknown): string {
  if (error instanceof ItemOperationError) return error.message;
  return userFacingMessage(error);
}

const SYSTEM_BOARD_MESSAGE =
  "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다";

/**
 * 일괄 복제 — 건별 안정 requestId·새 ID를 쓴다.
 * `idempotencyKey` 를 같이 넘기면 실패분만 다시 실행해도 같은 requestId가 나가
 * RPC가 replay하고 중복 행을 만들지 않는다 (키가 없으면 호출마다 새로 만든다).
 */
export async function bulkDuplicateAction(input: {
  boardId: string;
  itemIds: string[];
  idempotencyKey?: string;
  newItemIds?: Readonly<Record<string, string>>;
}): Promise<BulkDuplicateResult> {
  const ids = [...new Set(input.itemIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  const gate = await requireBulkWritePermission("work.item_upsert");
  if (!gate.ok) return allFailed(ids, gate.message);

  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  let source: string | null;
  try {
    const detail = await graph.service.getBoardDetail(gate.ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed(ids, SYSTEM_BOARD_MESSAGE);
    }
    source = detail.board.source;
  } catch (error) {
    return allFailed(ids, toMessage(error));
  }

  let client: ReturnType<typeof requireRequestClient>;
  try {
    client = requireRequestClient(graph.client, "일괄 복제");
  } catch (error) {
    return allFailed(ids, toMessage(error));
  }

  const bulkKey = input.idempotencyKey ?? newBulkKey();
  const canonical = requiresCanonicalDuplicate(source);
  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  const processed: BulkDuplicateItemResult[] = [];
  for (const itemId of head) {
    const requestId = deriveItemRequestId(bulkKey, canonical ? "duplicate-canonical" : "duplicate", itemId);
    const newItemId = input.newItemIds?.[itemId] ?? deriveItemRequestId(bulkKey, "duplicate-new-item", itemId);
    try {
      if (canonical) {
        const receipt = await duplicateCanonicalDealItemAtomic(client, {
          orgId: gate.ctx.org.id,
          boardId: input.boardId,
          sourceItemId: itemId,
          requestId,
          newItemId,
        });
        processed.push({
          itemId,
          newItemId: receipt.new_item_id,
          ok: true,
          message: "같은 회사로 새 신청을 복제했습니다. 전화번호·이메일·외부 식별번호와 승인·서명 정보는 복사하지 않습니다.",
        });
      } else {
        const receipt = await duplicateItemAtomic(client, {
          orgId: gate.ctx.org.id,
          boardId: input.boardId,
          itemId,
          requestId,
          newItemId,
        });
        processed.push({
          itemId,
          newItemId: receipt.new_item_id,
          ok: true,
          message: receipt.skipped_values > 0
            ? `복제했습니다(값 ${receipt.copied_values}개 복사·${receipt.skipped_values}개 제외 — 승인·서명 등은 옮기지 않습니다).`
            : "복제했습니다.",
        });
      }
    } catch (error) {
      processed.push({ itemId, newItemId: null, ok: false, message: toMessage(error) });
    }
  }
  if (processed.some((r) => r.ok)) revalidatePath(`/boards/${input.boardId}`);
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}
