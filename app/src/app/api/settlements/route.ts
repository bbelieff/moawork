/**
 * /api/settlements — 정산 목록+집계(GET, ?dealId= 필터) / 생성(POST).
 *
 * GET  → { data: { items, summary } }  집계: 실행액·계약금·수수료·총매출 합계 + 입금 건수.
 * POST → 생성된 정산 1건(201). 파생값(fee_amount·total_revenue·d180·d365)은 저장소가 채운다.
 */

import { requireCtx, jsonOk, toErrorResponse, readJson } from "@/lib/crm";
import {
  getSettlementsService,
  parseCreateSettlement,
} from "@/lib/policyfund/settlements";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const dealId = new URL(req.url).searchParams.get("dealId") ?? undefined;
    return jsonOk(getSettlementsService().listWithSummary(ctx, { dealId }));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const input = parseCreateSettlement(await readJson(req));
    return jsonOk(getSettlementsService().create(ctx, input), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
