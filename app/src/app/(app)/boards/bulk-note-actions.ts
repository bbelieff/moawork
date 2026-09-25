"use server";

/**
 * 일괄 메모 — agenda06 승인된 소규모 작업 (독립 메모 op, 바에 나란히 둔다).
 *
 * 기존 인가 경로를 그대로 쓴다:
 *  - `add_board_item_detail_event` RPC (item-detail-actions.ts의 addItemDetailEventAction과 동일 RPC·게이트)
 *  - 권한은 `work.item_upsert`와 `danger.bulk_edit_delete` 모두 필요하며 위험 작업을 기록한다.
 *  - actor는 세션에서 유도 — 호출부가 actor_id를锻造하지 않는다 (RPC가 auth에서 가져간다).
 *
 * 안전 규칙:
 *  - 시스템 보드는 쓰기 전에 거부.
 *  - kind는 고를 수 있는 넷만 (memo/call/admin/meeting) — field_change·모르는 값은 구조적 실패.
 *  - 본문은 비어 있지 않고 2000자 이내.
 *  - requestId는 행마다 안정적인 UUID를 호출부가 들고 온다 — 같은 ID로 다시 부르면
 *    RPC의 멱등성으로 중복 이벤트가 생기지 않는다 (안전한 재시도).
 *  - 본 작업(상태·담당 등)의 성공을 메모 실패로 오염시키지 않는다 — 호출부는
 *    메모 결과를 별도로 보여주고 본 작업은 그대로 성공으로 둔다.
 */

import { requireBulkWritePermission } from "./bulk-permission";
import { createRequestBoards } from "@/lib/boards/server";
import { userFacingMessage } from "@/lib/boards/boardActionFlash";
import { BULK_MAX_ITEMS } from "@/components/board/bulk-selection";
import {
  isSelectableDetailEventKind,
  type SelectableDetailEventKind,
} from "@/lib/boards/detail-event-kinds";

export type BulkNoteItemResult = {
  itemId: string;
  ok: boolean;
  message: string;
};

export type BulkNoteResult = {
  ok: boolean;
  applied: number;
  failed: number;
  results: BulkNoteItemResult[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SYSTEM_BOARD_MESSAGE =
  "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다";

function allFailed(itemIds: readonly string[], message: string): BulkNoteResult {
  return {
    ok: false,
    applied: 0,
    failed: itemIds.length,
    results: itemIds.map((itemId) => ({ itemId, ok: false as const, message })),
  };
}

function toResult(
  processed: BulkNoteItemResult[],
  skipped: readonly string[],
  skipMessage: string,
): BulkNoteResult {
  const results: BulkNoteItemResult[] = [
    ...processed,
    ...skipped.map((itemId) => ({ itemId, ok: false as const, message: skipMessage })),
  ];
  const applied = results.filter((r) => r.ok).length;
  return { ok: applied > 0 && applied === results.length, applied, failed: results.length - applied, results };
}

function canSeeAll(ctx: { role: string; scope: string }): boolean {
  return ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all";
}

/** 독립 메모 일괄 — 선택한 행마다 한 줄씩 남긴다. */
export async function bulkAddNoteAction(input: {
  boardId: string;
  itemIds: string[];
  kind: SelectableDetailEventKind;
  body: string;
  /** 행 id → 안정 UUID. 같은 쌍으로 다시 부르면 중복 없이 재시도된다. */
  requestIds: Record<string, string>;
}): Promise<BulkNoteResult> {
  const ids = [...new Set(input.itemIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  if (!isSelectableDetailEventKind(input.kind)) {
    return allFailed(ids, "메모 종류를 확인하세요.");
  }
  const body = input.body.trim();
  if (!body) {
    return allFailed(ids, "메모 내용을 입력하세요.");
  }
  if (body.length > 2000) {
    return allFailed(ids, "메모는 2000자 이내로 입력하세요.");
  }
  for (const itemId of ids) {
    const requestId = input.requestIds?.[itemId];
    if (typeof requestId !== "string" || !UUID.test(requestId)) {
      return allFailed(ids, "요청 정보가 올바르지 않습니다.");
    }
  }

  const gate = await requireBulkWritePermission("work.item_upsert");
  if (!gate.ok) return allFailed(ids, gate.message);
  const ctx = gate.ctx;

  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }
  if (!graph.client) {
    return allFailed(ids, "메모 저장: 이 동작은 연결된 워크스페이스가 필요합니다.");
  }

  try {
    const detail = await graph.service.getBoardDetail(ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed(ids, SYSTEM_BOARD_MESSAGE);
    }
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  const allowScoped = canSeeAll(ctx);
  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  const processed: BulkNoteItemResult[] = [];
  for (const itemId of head) {
    try {
      // 소속·가시성 확인이 쓰기보다 먼저다 (단일 상세 context와 같은 조건).
      const item = await graph.service.getItem(ctx, input.boardId, itemId);
      if (!allowScoped && item.assigned_to !== ctx.user.id) {
        processed.push({ itemId, ok: false, message: "이 회사 정보를 열 권한이 없거나 항목을 찾을 수 없습니다." });
        continue;
      }
      const { error } = await graph.client.rpc("add_board_item_detail_event", {
        p_org_id: ctx.org.id,
        p_board_id: input.boardId,
        p_item_id: itemId,
        p_kind: input.kind,
        p_body: body,
        p_request_id: input.requestIds[itemId],
        p_mentioned_user_ids: [],
      });
      if (error) {
        processed.push({
          itemId,
          ok: false,
          message:
            error.code === "42501"
              ? "기록을 추가할 권한이 없습니다."
              : "기록을 저장하지 못했습니다. 입력은 그대로 두었습니다.",
        });
        continue;
      }
      processed.push({ itemId, ok: true, message: "메모를 남겼습니다." });
    } catch (error) {
      processed.push({ itemId, ok: false, message: userFacingMessage(error) });
    }
  }
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}
