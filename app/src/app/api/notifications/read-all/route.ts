/**
 * /api/notifications/read-all — "모두 읽음".
 * ★ 점만 제거한다. 숫자(할 일)는 resolved_at 을 건드리지 않으므로 그대로 남는다.
 */

import { requireCtx } from "@/lib/crm/context";
import { jsonOk, toErrorResponse } from "@/lib/crm/http";
import { markAllRead } from "@/lib/notify/server";

export async function POST(): Promise<Response> {
  try {
    const ctx = await requireCtx();
    await markAllRead(ctx);
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
