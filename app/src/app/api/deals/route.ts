/**
 * /api/deals — 딜 목록(GET, ?stageId= & ?companyId= 필터, 담당범위 적용) / 생성(POST).
 */

import { getCrmService, requireCtx, parseCreateDeal, jsonOk, toErrorResponse, readJson } from "@/lib/crm";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const sp = new URL(req.url).searchParams;
    const deals = getCrmService().listDeals(ctx, {
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
    const ctx = await requireCtx();
    const input = parseCreateDeal(await readJson(req));
    return jsonOk(getCrmService().createDeal(ctx, input), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
