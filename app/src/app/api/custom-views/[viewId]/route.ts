/**
 * /api/custom-views/[viewId] — 수정(PATCH: name/config/shared) / 삭제(DELETE).
 */

import {
  getCustomService,
  requireCtx,
  parseViewConfig,
  ValidationError,
  jsonOk,
  toErrorResponse,
  readJson,
} from "@/lib/custom";

type RouteCtx = { params: Promise<{ viewId: string }> };

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { viewId } = await params;
    const body = await readJson(req);
    if (typeof body !== "object" || body === null)
      throw new ValidationError("본문이 객체가 아닙니다");
    const b = body as Record<string, unknown>;
    const patch: { name?: string; shared?: boolean; config?: ReturnType<typeof parseViewConfig> } = {};
    if (b.name !== undefined) {
      if (typeof b.name !== "string" || b.name.trim() === "")
        throw new ValidationError("name: 비어 있을 수 없습니다");
      patch.name = b.name.trim();
    }
    if (b.shared !== undefined) {
      if (typeof b.shared !== "boolean") throw new ValidationError("shared: 불리언이어야 합니다");
      patch.shared = b.shared;
    }
    if (b.config !== undefined) patch.config = parseViewConfig(b.config);
    if (Object.keys(patch).length === 0) throw new ValidationError("변경할 필드가 없습니다");
    return jsonOk(await getCustomService().updateView(ctx.org.id, viewId, patch));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { viewId } = await params;
    return jsonOk({ deleted: await getCustomService().deleteView(ctx.org.id, viewId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
