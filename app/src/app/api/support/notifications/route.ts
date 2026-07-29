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

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const raw = (await readJson(req)) as { ids?: unknown };
    const ids = Array.isArray(raw?.ids)
      ? raw.ids.filter((v): v is string => typeof v === "string")
      : undefined;
    return jsonOk({ marked: getSupportService().markRead(ctx, ids) });
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}
