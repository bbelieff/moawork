/**
 * /api/boards/[boardId]/views — 저장뷰 목록(GET) / 생성(POST).
 */

import { getService, getRequestContext } from "@/lib/crm";
import { parseCreateView } from "@/lib/crm/validation";
import { jsonOk, toErrorResponse, readJson } from "@/lib/crm/http";

type Ctx = { params: Promise<{ boardId: string }> };

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { boardId } = await params;
    const views = await getService().listViews(ctx, boardId);
    return jsonOk(views);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { boardId } = await params;
    const input = parseCreateView(await readJson(req));
    const view = await getService().createView(ctx, boardId, input);
    return jsonOk(view, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
