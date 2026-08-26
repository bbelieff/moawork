import type { Board } from "@/lib/boards/types";
import type { Ctx } from "@/lib/types";
import { TAB_SOURCE_NAV_KEY } from "@/components/shell/active-nav";

export interface NavMapBoardsReader {
  listBoards(ctx: Ctx): Promise<Board[]>;
}

/** 순수 부분 — 보드 목록에서 «기본 탭인 것만» 골라 id → 메뉴 키로 만든다. */
export function boardNavKeysFrom(boards: readonly Board[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const board of boards) {
    const key = board.source ? TAB_SOURCE_NAV_KEY[board.source] : undefined;
    if (key) map[board.id] = key;
  }
  return map;
}

/**
 * 사이드바가 «지금 이 보드가 어느 탭인가» 를 알기 위한 지도.
 *
 * 못 읽으면 빈 지도를 준다 — 활성 표시가 안 될 뿐, 셸이 통째로 죽지 않는다.
 * 셸은 모든 화면의 뼈대라서 여기서 던지면 앱 전체가 500 이 된다.
 */
export async function loadBoardNavKeys(
  ctx: Ctx,
  repo: NavMapBoardsReader,
): Promise<Record<string, string>> {
  try {
    return boardNavKeysFrom(await repo.listBoards(ctx));
  } catch {
    return {};
  }
}
