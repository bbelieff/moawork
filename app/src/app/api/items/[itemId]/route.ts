/**
 * /api/items/[itemId] — 아이템 상세(GET) / 수정(PATCH: 이름·컬럼값) / 삭제(DELETE).
 */

import { getService, getRequestContext } from "@/lib/crm";
import { parseUpdateItem } from "@/lib/crm/validation";
import { jsonOk, toErrorResponse, readJson } from "@/lib/crm/http";

type Ctx = { params: Promise<{ itemId: string }> };

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { itemId } = await params;
    const item = await getService().getItem(ctx, itemId);
    return jsonOk(item);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { itemId } = await params;
    const patch = parseUpdateItem(await readJson(req));
    const item = await getService().updateItem(ctx, itemId, patch);
    return jsonOk(item);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { itemId } = await params;
    await getService().deleteItem(ctx, itemId);
    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
