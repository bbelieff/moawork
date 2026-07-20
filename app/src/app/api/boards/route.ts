/**
 * /api/boards — 보드 목록(GET) / 생성(POST).
 * 생성 시 기본 4단계 파이프라인 + 수식 포함 컬럼 세트가 프로비저닝된다.
 */

import { getService, getRequestContext } from "@/lib/crm";
import { parseCreateBoard } from "@/lib/crm/validation";
import { jsonOk, toErrorResponse, readJson } from "@/lib/crm/http";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const boards = await getService().listBoards(ctx);
    return jsonOk(boards);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = getRequestContext(req);
    const input = parseCreateBoard(await readJson(req));
    const created = await getService().createBoard(ctx, input);
    return jsonOk(created, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
