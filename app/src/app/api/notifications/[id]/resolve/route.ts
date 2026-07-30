/**
 * /api/notifications/[id]/resolve — 처리 완료(숫자 감소).
 * ★ 실제 행동(항목 클릭으로 대상 화면 이동 등)이 있을 때만 호출한다.
 *   화면 진입 경로에서는 절대 호출하지 않는다 — 그러면 할 일이 조용히 사라진다.
 */

import { requireCtx } from "@/lib/crm/context";
import { jsonOk, toErrorResponse } from "@/lib/crm/http";
import { resolveNotification } from "@/lib/notify/server";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { id } = await params;
    await resolveNotification(ctx, id);
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
