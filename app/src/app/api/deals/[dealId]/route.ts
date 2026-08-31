/**
 * /api/deals/[dealId] — 상세(GET) / 수정(PATCH, 단계 제외) / 삭제(DELETE).
 * 단계 변경은 /api/deals/[dealId]/move 사용.
 */

import { getCrmService, requireCtx, parseUpdateDeal, ValidationError, jsonOk, toErrorResponse, readJson } from "@/lib/crm";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { dealId } = await params;
    return jsonOk(await getCrmService().getDeal(ctx, dealId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { dealId } = await params;
    const patch = parseUpdateDeal(await readJson(req));
    return jsonOk(await getCrmService().updateDeal(ctx, dealId, patch));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    await requireCtx();
    await params;
    throw new ValidationError("Case 삭제는 지원하지 않습니다.");
  } catch (err) {
    return toErrorResponse(err);
  }
}
