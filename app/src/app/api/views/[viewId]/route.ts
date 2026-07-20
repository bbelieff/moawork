/**
 * /api/views/[viewId] — 저장뷰 수정(PATCH) / 삭제(DELETE).
 */

import { getService, getRequestContext } from "@/lib/crm";
import { parseCreateView } from "@/lib/crm/validation";
import { jsonOk, toErrorResponse, readJson } from "@/lib/crm/http";

type Ctx = { params: Promise<{ viewId: string }> };

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { viewId } = await params;
    // 부분 갱신 허용: name/config/isDefault 중 온 것만 반영.
    const body = (await readJson(req)) as Record<string, unknown>;
    const patch: { name?: string; config?: ReturnType<typeof parseCreateView>["config"]; isDefault?: boolean } = {};
    if (body.name !== undefined || body.config !== undefined || body.isDefault !== undefined) {
      // parseCreateView 로 형태 검증(name 필수 회피 위해 기본값 주입)
      const parsed = parseCreateView({
        name: body.name ?? "임시",
        config: body.config ?? {},
        isDefault: body.isDefault,
      });
      if (body.name !== undefined) patch.name = parsed.name;
      if (body.config !== undefined) patch.config = parsed.config;
      if (body.isDefault !== undefined) patch.isDefault = parsed.isDefault;
    }
    const view = await getService().updateView(ctx, viewId, patch);
    return jsonOk(view);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { viewId } = await params;
    await getService().deleteView(ctx, viewId);
    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
