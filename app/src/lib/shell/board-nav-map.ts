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
  openRepo: () => Promise<NavMapBoardsReader>,
): Promise<Record<string, string>> {
  // ★ 저장소를 «여는 것» 까지 try 안에 둔다.
  //   전에는 호출부가 밖에서 열어 넘겼는데, 그 여는 동작(createClient → 환경변수 읽기,
  //   쿠키 접근)도 던질 수 있다. 셸의 Promise.all 안에서 그게 터지면
  //   활성 표시만 빠지는 것이 아니라 **(app) 아래 모든 화면이 500** 이 된다.
  //   이 함수의 계약은 「못 읽으면 빈 지도」이므로, 못 여는 것도 못 읽는 것이다.
  try {
    return boardNavKeysFrom(await (await openRepo()).listBoards(ctx));
  } catch {
    return {};
  }
}
