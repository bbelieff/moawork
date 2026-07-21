/**
 * /api/companies — 고객사 목록(GET, 담당범위 적용) / 생성(POST).
 */

import { getCrmService, requireCtx, parseCreateCompany, jsonOk, toErrorResponse, readJson } from "@/lib/crm";

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireCtx();
    return jsonOk(getCrmService().listCompanies(ctx));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const input = parseCreateCompany(await readJson(req));
    return jsonOk(getCrmService().createCompany(ctx, input), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
