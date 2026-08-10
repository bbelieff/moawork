/**
 * /api/companies/[companyId] — 상세(GET) / 수정(PATCH) / 삭제(DELETE).
 */

import { getCrmService, requireCtx, parseUpdateCompany, jsonOk, toErrorResponse, readJson } from "@/lib/crm";

type Ctx = { params: Promise<{ companyId: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { companyId } = await params;
    return jsonOk(await getCrmService().getCompany(ctx, companyId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { companyId } = await params;
    const patch = parseUpdateCompany(await readJson(req));
    return jsonOk(await getCrmService().updateCompany(ctx, companyId, patch));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { companyId } = await params;
    await getCrmService().deleteCompany(ctx, companyId);
    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
