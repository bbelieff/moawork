/**
 * /api/boards/[boardId]/views — 보드 저장뷰 목록(GET) / 생성(POST).
 *
 * GET ?default=1 이면 기본 뷰 1건만 반환한다.
 * 기본 뷰 규약: shared 우선 → name ASC → id ASC (기획2 OQ-4 재판정 —
 * 003 board_views 에 created_at/is_default 가 없어 확정된 결정적 규약).
 */

import { getBoardsService } from "@/lib/boards";
import { parseNewView } from "@/lib/boards/validation";
import { jsonOk, readJson, requireCtx, toErrorResponse } from "@/lib/boards/http";

type Params = { params: Promise<{ boardId: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { boardId } = await params;
    const svc = getBoardsService();

    if (new URL(req.url).searchParams.get("default") === "1") {
      return jsonOk(svc.getDefaultView(ctx, boardId));
    }
    return jsonOk(svc.listViews(ctx, boardId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { boardId } = await params;
    const input = parseNewView(await readJson(req));
    return jsonOk(getBoardsService().createView(ctx, boardId, input), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
