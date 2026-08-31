/**
 * /api/deals/[dealId]/activities — 활동 목록(GET, 최신순) / 추가(POST, call|meeting|memo).
 */

import { getCrmService, requireCtx, parseCreateActivity, jsonOk, toErrorResponse, readJson } from "@/lib/crm";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { dealId } = await params;
    return jsonOk(await getCrmService().listActivities(ctx, dealId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { dealId } = await params;
    const { requestId, ...input } = parseCreateActivity(await readJson(req));
    return jsonOk(await getCrmService().appendCaseActivity(ctx, dealId, input, requestId), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
