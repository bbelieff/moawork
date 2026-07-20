/**
 * /api/items/[itemId]/move — 파이프라인 단계 이동(POST).
 * body: { stageKey }. 이동 자동화(계약일 자동세팅·완료 스탬프)가 함께 적용된다.
 */

import { getService, getRequestContext } from "@/lib/crm";
import { parseMoveStage } from "@/lib/crm/validation";
import { jsonOk, toErrorResponse, readJson } from "@/lib/crm/http";

type Ctx = { params: Promise<{ itemId: string }> };

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { itemId } = await params;
    const { stageKey } = parseMoveStage(await readJson(req));
    const item = await getService().moveItemStage(ctx, itemId, stageKey);
    return jsonOk(item);
  } catch (err) {
    return toErrorResponse(err);
  }
}
