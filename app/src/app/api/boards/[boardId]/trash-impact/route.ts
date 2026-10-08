/**
 * GET /api/boards/[boardId]/trash-impact — 탭을 휴지통에 보내기 전 «지울 내용» 개수.
 *
 * Issue 857 — 전에는 보드 화면을 열 때마다 서버가 이 개수를 세서 응답 끝에 흘려 보냈다(접힌 «탭 설정»
 * 안이라 거의 아무도 안 보는데 매번 DB 읽기 + 서버 계산). 이제 «탭 설정» 을 열 때만 화면이 이 주소를 부른다.
 * 서버 액션이 아니라 GET 이라 다른 저장 동작과 한 줄로 서지 않는다.
 *
 * 권한: 보드 화면이 «탭 삭제» 칸을 보여 주는 조건과 같다(danger.bulk_edit_delete). 판정 불능은 503.
 * 시스템 보드·없는 보드는 서비스가 404 로 막는다. 읽기는 요청 클라이언트(RLS)로만 한다.
 */
import { jsonOk, requireCtx, toErrorResponse } from "@/lib/boards/http";
import { createRequestBoards } from "@/lib/boards/server";
import { loadPermGuard } from "@/lib/perm/guard";

type Params = { params: Promise<{ boardId: string }> };

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const permission = await loadPermGuard(ctx.org.id, "danger.bulk_edit_delete");
    if (permission.kind === "denied") {
      return Response.json(
        { error: permission.reason === "unavailable" ? "권한을 확인하지 못했어요." : "이 작업을 할 권한이 없어요." },
        { status: permission.reason === "unavailable" ? 503 : 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    const { boardId } = await params;
    const { service } = await createRequestBoards();
    const response = jsonOk(await service.readBoardTrashImpact(ctx, boardId));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
