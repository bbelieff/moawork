/**
 * /api/deals — 딜 목록(GET, ?stageId= & ?companyId= 필터, 담당범위 적용) / 생성(POST).
 */

import { getCrmService, requireCtx, ValidationError, jsonOk, toErrorResponse } from "@/lib/crm";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const sp = new URL(req.url).searchParams;
    const deals = await getCrmService().listDeals(ctx, {
      stageId: sp.get("stageId") ?? undefined,
      companyId: sp.get("companyId") ?? undefined,
    });
    return jsonOk(deals);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    void req;
    await requireCtx();
    throw new ValidationError("Case 생성은 회사의 업무 시작 경로에서만 가능합니다.");
  } catch (err) {
    return toErrorResponse(err);
  }
}
