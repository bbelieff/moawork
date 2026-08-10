import type { Ctx } from "@/lib/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { SEOUL_NEWCUST_BOARD } from "@/lib/structure-packs";

export type NewcustEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" };

/**
 * 현재 조직의 기존 031 신규업체 보드를 유일하게 찾는다.
 *
 * GET 진입점은 조회·이동만 한다. 구조 팩 설치는 owner-only로 별도 승인된 경로에서만
 * 수행해야 하며, 마지막 방문 기록이나 query/cookie는 보드 권한·선택 근거로 쓰지 않는다.
 */
export function resolveExistingNewcustBoard(
  ctx: Ctx,
  repo: BoardsRepo = getBoardsRepo(),
): NewcustEntryResolution {
  const existing = repo
    .listBoards(ctx)
    .filter((board) => board.name === SEOUL_NEWCUST_BOARD.name);

  if (existing.length === 1) return { kind: "ready", boardId: existing[0].id };
  return { kind: existing.length === 0 ? "missing" : "conflict" };
}
