/**
 * /api/boards/[boardId] — 보드 상세(GET: 보드+단계+컬럼) / 수정(PATCH) / 삭제(DELETE).
 */

import { getService, getRequestContext } from "@/lib/crm";
import { parseUpdateBoard } from "@/lib/crm/validation";
import { jsonOk, toErrorResponse, readJson } from "@/lib/crm/http";

type Ctx = { params: Promise<{ boardId: string }> };

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { boardId } = await params;
    const detail = await getService().getBoardDetail(ctx, boardId);
    return jsonOk(detail);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { boardId } = await params;
    const patch = parseUpdateBoard(await readJson(req));
    const updated = await getService().updateBoard(ctx, boardId, patch);
    return jsonOk(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { boardId } = await params;
    await getService().deleteBoard(ctx, boardId);
    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
