/**
 * /api/fields/[fieldId] — 라벨 변경(PATCH) / 삭제(DELETE).
 * key·type 은 불변(저장값 해석이 깨지므로). 프리셋(module_key) 필드는 409.
 */

import {
  getCustomService,
  requireCtx,
  parseUpdateFieldDef,
  jsonOk,
  toErrorResponse,
  readJson,
} from "@/lib/custom";

type RouteCtx = { params: Promise<{ fieldId: string }> };

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { fieldId } = await params;
    const { label } = parseUpdateFieldDef(await readJson(req));
    return jsonOk(await getCustomService().renameField(ctx.org.id, fieldId, label!));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { fieldId } = await params;
    return jsonOk({ deleted: await getCustomService().deleteField(ctx.org.id, fieldId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
