/**
 * /api/pipelines — 조직 파이프라인 목록(단계 포함) GET. 칸반 보드 렌더 소스.
 */

import { getCrmService, requireCtx, jsonOk, toErrorResponse } from "@/lib/crm";

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireCtx();
    return jsonOk(await getCrmService().listPipelines(ctx));
  } catch (err) {
    return toErrorResponse(err);
  }
}
