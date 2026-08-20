/**
 * /api/fields/[fieldId] — 라벨 변경(PATCH) / 삭제(DELETE).
 * key·type 은 불변(저장값 해석이 깨지므로). 프리셋(module_key) 필드는 409.
 */

import {
  createRequestCustomService,
  requireCtx,
  parseUpdateFieldDef,
  jsonOk,
  toErrorResponse,
  readJson,
  CUSTOM_FIELD_DELETE_CONFIRM,
  ForbiddenError,
  ServiceUnavailableError,
} from "@/lib/custom";
import { loadPermGuard } from "@/lib/perm/guard";

type RouteCtx = { params: Promise<{ fieldId: string }> };

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { fieldId } = await params;
    const { label } = parseUpdateFieldDef(await readJson(req));
    return jsonOk(await (await createRequestCustomService()).renameField(ctx.org.id, fieldId, label!));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    if (req.headers.get("x-moawork-confirm") !== CUSTOM_FIELD_DELETE_CONFIRM) {
      return Response.json({ error: "커스텀필드 삭제는 확인 단계를 거쳐야 합니다" }, { status: 400 });
    }
    const ctx = await requireCtx();
    const permission = await loadPermGuard(ctx.org.id, "structure.column_manage");
    if (permission.kind === "denied") {
      if (permission.reason === "unavailable") throw new ServiceUnavailableError();
      throw new ForbiddenError();
    }
    const { fieldId } = await params;
    return jsonOk({ deleted: await (await createRequestCustomService()).deleteField(ctx.org.id, fieldId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
