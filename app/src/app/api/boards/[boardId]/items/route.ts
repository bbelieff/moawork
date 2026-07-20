/**
 * /api/boards/[boardId]/items — 아이템 목록(GET, ?viewId= 로 저장뷰 적용) / 생성(POST).
 * 목록 응답의 각 아이템은 입력값(values) + 계산된 수식(formulas)을 포함한다.
 */

import { getService, getRequestContext } from "@/lib/crm";
import { parseCreateItem } from "@/lib/crm/validation";
import { jsonOk, toErrorResponse, readJson } from "@/lib/crm/http";

type Ctx = { params: Promise<{ boardId: string }> };

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { boardId } = await params;
    const viewId = new URL(req.url).searchParams.get("viewId") ?? undefined;
    const items = await getService().listItems(ctx, boardId, { viewId });
    return jsonOk(items);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const { boardId } = await params;
    const input = parseCreateItem(await readJson(req));
    const item = await getService().createItem(ctx, boardId, input);
    return jsonOk(item, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
