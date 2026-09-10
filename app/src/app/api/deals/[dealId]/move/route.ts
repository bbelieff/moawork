/**
 * /api/deals/[dealId]/move — 파이프라인 단계 이동(POST). body: { stageId }.
 * 먼데이 "이동" 자동화 재현: stage 갱신 + status 활동로그.
 */

import { getCrmService, requireCtx, parseMoveStage, jsonOk, toErrorResponse, readJson } from "@/lib/crm";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { dealId } = await params;
    const { stageId, requestId, expectedVersion } = parseMoveStage(await readJson(req));
    return jsonOk(await getCrmService().moveCaseStage(ctx, dealId, stageId, { requestId, expectedVersion }));
  } catch (err) {
    return toErrorResponse(err);
  }
}
