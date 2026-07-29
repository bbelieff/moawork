/**
 * /api/notifications — 알림 스냅샷(벨 뱃지 + 사이드바 뱃지 + 두 탭 목록).
 * 조회 전용. 여기서는 어떤 읽음/처리 표시도 하지 않는다
 * (조회만으로 숫자가 사라지면 안 되기 때문).
 */

import { requireCtx } from "@/lib/crm/context";
import { jsonOk, toErrorResponse } from "@/lib/crm/http";
import { loadNotifySnapshot } from "@/lib/notify/server";

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireCtx();
    return jsonOk(await loadNotifySnapshot(ctx));
  } catch (err) {
    return toErrorResponse(err);
  }
}
