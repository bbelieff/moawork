/**
 * /api/support/notifications — 뱃지 숫자·알림 목록(GET) / 읽음 처리(POST). T08.
 * 숫자 = "내가 볼 일" (미읽음 운영자 답변 + 위임 알림).
 */

import { requireCtx } from "@/lib/crm/context";
import { getSupportService } from "@/lib/support";
import { jsonOk, readJson, toSupportErrorResponse } from "@/lib/support/http";

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const service = getSupportService();
    return jsonOk({
      unread: service.unreadCount(ctx),
      items: service.listNotifications(ctx, { unreadOnly: true }),
    });
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}

/**
 * 읽음 처리.
 * - `{ids: [...]}` → 지정한 알림만.
 * - 본문 없음(`{}`) → **답변 알림만**. 위임 알림은 화면 진입만으로 지우지 않는다
 *   (오너가 처리해야 하는 행동 항목이므로 — T06 "봤다 ≠ 했다" 계약).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const raw = (await readJson(req)) as { ids?: unknown };
    const service = getSupportService();
    const marked = Array.isArray(raw?.ids)
      ? service.markRead(
          ctx,
          raw.ids.filter((v): v is string => typeof v === "string"),
        )
      : service.markThreadsRead(ctx);
    return jsonOk({ marked });
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}
