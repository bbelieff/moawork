"use server";

import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadPermGuard } from "@/lib/perm/guard";
import { loadItemDetailAction, type ItemDetailSnapshot } from "./item-detail-actions";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 히스토리 메모 고치기 전용 액션(v17-detail-repair).
 *
 * 기존 boards/actions.ts·item-detail-actions.ts와 동시에 쓰지 않기 위해
 * 별도 파일로 둔다. 권한·테넌트·소유·가시성·원장·버전 판정은 서버 RPC
 * `update_board_item_detail_event`(마이그레이션 150)가 하며, 여기는 입력
 * 검증과 화면 스냅샷 재조회만 한다. 실패 시 입력은 호출자가 유지하고,
 * stale/충돌이면 명시적 새로고침을 권한다.
 */
export async function updateItemDetailEventAction(input: {
  boardId: string;
  itemId: string;
  eventId: string;
  body: string;
  requestId: string;
  expectedEditCount?: number | null;
  baseBody?: string | null;
}): Promise<ItemDetailSnapshot> {
  try {
    const ctx = await getSession();
    if (!UUID.test(input.boardId) || !UUID.test(input.itemId) || !UUID.test(input.eventId)) {
      throw new Error("기록 식별자가 올바르지 않습니다.");
    }
    if (!UUID.test(input.requestId)) throw new Error("요청 식별자가 올바르지 않습니다.");
    const body = input.body.trim();
    if (!body || body.length > 4000) {
      throw new Error("기록은 1자 이상 4000자 이내로 입력해 주세요. 입력은 그대로 두었습니다.");
    }
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") {
      throw new Error(
        permission.reason === "permission"
          ? "기록을 고칠 권한이 없습니다."
          : "권한을 확인하지 못했습니다.",
      );
    }
    const client = await createClient();
    const { error } = await client.rpc("update_board_item_detail_event", {
      p_org_id: ctx.org.id,
      p_board_id: input.boardId,
      p_item_id: input.itemId,
      p_event_id: input.eventId,
      p_body: body,
      p_request_id: input.requestId,
      p_expected_edit_count: input.expectedEditCount ?? null,
      p_base_body: input.baseBody ?? null,
    });
    if (error) {
      const message = error.message ?? "";
      const isStale =
        error.code === "23505" &&
        (message.includes("stale_detail_event_edit") || message.includes("request_replay_conflict"));
      throw new Error(
        error.code === "42501"
          ? "이 기록을 고칠 권한이 없습니다. 쓴 사람과 회사대표만 고칠 수 있어요. 입력은 그대로 두었습니다."
          : error.code === "P0002"
            ? "그 기록을 찾지 못했습니다. 화면을 새로 고쳐 주세요. 입력은 그대로 두었습니다."
            : isStale || error.code === "23505"
              ? "다른 저장이 먼저 됐습니다. 입력은 그대로 두었습니다. 새로고침으로 최신을 확인한 뒤 다시 저장해 주세요."
              : "기록을 고치지 못했습니다. 입력은 그대로 두었습니다.",
      );
    }
    return loadItemDetailAction(input.boardId, input.itemId);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "기록을 고치지 못했습니다.",
      events: [],
      links: [],
      files: [],
      members: [],
    };
  }
}
