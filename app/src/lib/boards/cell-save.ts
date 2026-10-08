import type { Ctx } from "@/lib/types";
import { boardCellValueFromFormData } from "@/lib/boards/form-values";
import { UserFacingActionError } from "@/lib/boards/boardActionFlash";
import type { createRequestBoards } from "@/lib/boards/server";
import type { SetCellsResult } from "@/lib/boards/service";
import type { BoardColumn, CellValue } from "@/lib/boards/types";

type RequestBoards = Awaited<ReturnType<typeof createRequestBoards>>;

/**
 * 셀 하나 쓰기의 공통 본체 — 화면 전체를 다시 그리는 `setCellAction` 과 결과만 돌려주는
 * `saveCellValueAction`(Issue 857)이 같은 검증을 쓰게 한다. 사람 칸은 이 회사의 활성 멤버만 받는다.
 * 권한 판정과 실패를 화면에 알리는 방식은 호출부가 정한다.
 */
export async function writeBoardCell(
  ctx: Ctx,
  graph: RequestBoards,
  input: { boardId: string; itemId: string; columnKey: string; formData: FormData },
): Promise<{ saved: SetCellsResult; changedColumn?: BoardColumn }> {
  const { boardId, itemId, columnKey, formData } = input;
  const normalized = boardCellValueFromFormData(formData);
  let changedColumn: BoardColumn | undefined;
  if (graph.client) {
    changedColumn = (await graph.service.getBoardDetail(ctx, boardId)).columns.find((candidate) => candidate.key === columnKey);
    const column = changedColumn;
    if (!column) throw new UserFacingActionError("기록 항목을 찾을 수 없어요.");
    if (column.type === "person" || column.type === "people") {
      const ids = (Array.isArray(normalized) ? normalized : normalized ? [normalized] : [])
        .filter((value): value is string => typeof value === "string");
      if (ids.length > 0) {
        const members = await graph.client.from("org_members").select("user_id")
          .eq("org_id", ctx.org.id).eq("status", "active").in("user_id", ids);
        if (members.error || new Set((members.data ?? []).map((member) => member.user_id)).size !== new Set(ids).size) {
          throw new UserFacingActionError("이 회사에 속한 사람만 선택할 수 있어요.");
        }
      }
    }
  }
  const patch: Record<string, CellValue> = { [columnKey]: normalized };
  const saved = await graph.service.setCells(ctx, boardId, itemId, patch);
  return { saved, changedColumn };
}
