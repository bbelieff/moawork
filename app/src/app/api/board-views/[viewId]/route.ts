/**
 * /api/board-views/[viewId] — 저장뷰 수정(PATCH) / 삭제(DELETE).
 *
 * 뷰는 보드에 속하지만 id 로 직접 지목하므로 boardId 를 경로에 두지 않는다
 * (board_id 이동은 지원하지 않음 — ViewPatch 에 board_id 없음).
 * 가시성(공유뷰 ∪ 내 개인뷰)은 repo 계층에서 적용된다.
 */

import { getBoardsService } from "@/lib/boards";
import { parseViewPatch } from "@/lib/boards/validation";
import { jsonOk, readJson, requireCtx, toErrorResponse } from "@/lib/boards/http";

type Params = { params: Promise<{ viewId: string }> };

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { viewId } = await params;
    const patch = parseViewPatch(await readJson(req));
    return jsonOk(await getBoardsService().updateView(ctx, viewId, patch));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { viewId } = await params;
    await getBoardsService().deleteView(ctx, viewId);
    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
