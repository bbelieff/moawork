import type { Board, DefaultTabDismissal } from "@/lib/boards/types";
import type { Ctx } from "@/lib/types";
import { TAB_SOURCE_NAV_KEY } from "@/components/shell/active-nav";
import { userTabNavKey, type SidebarUserTab } from "@/components/shell/user-tabs";
import { NOTICE_BOARD_NAME } from "@/lib/notices/types";

export interface NavMapBoardsReader {
  listBoards(ctx: Ctx): Promise<Board[]>;
  listDefaultTabDismissals(ctx: Ctx): Promise<DefaultTabDismissal[]>;
}

/** 셸(사이드바·라우트 강조)이 보드 목록에서 읽어 가는 것 전부. */
export interface SidebarBoards {
  /** 보드 id → 메뉴 키. 기본 탭은 그 메뉴 키(new·work …), 사용자 탭은 «board:<id>». */
  boardNavKeys: Record<string, string>;
  /** 업무 › 계약 전/계약 후 끝에 붙는 사용자 탭(정렬 순서대로). */
  userTabs: SidebarUserTab[];
  /** 회사가 지운 기본 탭의 source — 그 기본 메뉴를 숨긴다. */
  dismissedSources: string[];
}

/**
 * 옛 공지 보드 — 예전 런타임 생성(NoticesService.ensureBoard)은 source 없이 이름 «공지사항» 으로 만들었다.
 * NoticesService.findBoard 와 RLS(migration 061: `source is null and name = '공지사항'`)가 이것을 공지 보드로
 * 보므로 사이드바도 같은 규칙으로 «사용자 탭이 아님» 으로 본다 — 안 그러면 업무 › 계약 후 끝에
 * 종합 › 공지사항과 겹치는 줄이 생기고, 공지 기본 탭을 지워도 남는다.
 */
function isLegacyNoticeBoard(board: Board): boolean {
  return board.source == null && board.name === NOTICE_BOARD_NAME;
}

/**
 * 사용자가 만든 탭인가 — source 가 없고(기본 탭·프리셋 보관용 보드는 source 가 있다), 휴지통에 있지 않고,
 * 옛 공지 보드가 아니다. listBoards 가 이미 휴지통을 거르지만 이 판정이 사이드바의 마지막 문이라 한 번 더 본다.
 */
function isUserTab(board: Board): boolean {
  return board.source == null && !board.deleted_at && !isLegacyNoticeBoard(board);
}

/** 순수 부분 — 보드 목록에서 기본 탭과 사용자 탭만 골라 id → 메뉴 키로 만든다. */
export function boardNavKeysFrom(boards: readonly Board[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const board of boards) {
    if (board.deleted_at) continue;
    if (isUserTab(board)) {
      // 사용자 탭은 자기 줄 하나만 켠다 — 기본 메뉴 키와 겹치지 않는 «board:<id>».
      map[board.id] = userTabNavKey(board.id);
      continue;
    }
    const key = board.source && Object.hasOwn(TAB_SOURCE_NAV_KEY, board.source)
      ? TAB_SOURCE_NAV_KEY[board.source]
      : undefined;
    if (key) map[board.id] = key;
  }
  return map;
}

/** 순수 부분 — 사용자 탭을 sort_order 순으로(같으면 받은 순서) 사이드바 줄 데이터로 만든다. */
export function sidebarUserTabsFrom(boards: readonly Board[]): SidebarUserTab[] {
  return boards
    .map((board, index) => ({ board, index }))
    .filter(({ board }) => isUserTab(board))
    .sort((a, b) => (a.board.sort_order - b.board.sort_order) || (a.index - b.index))
    .map(({ board }) => ({
      id: board.id,
      name: board.name,
      icon: board.icon ?? null,
      navSection: board.nav_section === "before-contract" ? "before-contract" : "after-contract",
    }));
}

/**
 * 순수 부분 — 숨길 기본 탭. 지운 기록이 있어도 같은 source 의 탭이 지금 살아 있으면 숨기지 않는다
 * (기록과 실제가 어긋나도 «있는 탭이 메뉴에서 사라지는» 쪽으로는 틀리지 않게).
 */
export function dismissedSourcesFrom(
  dismissals: readonly DefaultTabDismissal[],
  boards: readonly Board[],
): string[] {
  const live = new Set(boards.filter((board) => !board.deleted_at && board.source).map((board) => board.source));
  return [...new Set(dismissals.map((row) => row.source))].filter((source) => !live.has(source));
}

/**
 * 사이드바가 «지금 이 보드가 어느 탭인가» · «어떤 사용자 탭을 그릴까» · «어떤 기본 탭을 숨길까» 를
 * 알기 위한 한 번의 읽기. 보드 목록과 지운 기본 탭 기록을 같이 출발시킨다.
 *
 * 못 읽으면 그 부분만 비운다 — 활성 표시·사용자 탭·숨김이 안 될 뿐, 셸이 통째로 죽지 않는다.
 * 셸은 모든 화면의 뼈대라서 여기서 던지면 앱 전체가 500 이 된다.
 */
export async function loadSidebarBoards(ctx: Ctx, repo: NavMapBoardsReader): Promise<SidebarBoards> {
  const [boardsResult, dismissalsResult] = await Promise.allSettled([
    // 동기 예외도 «거절» 로 받으려고 then 안에서 부른다.
    Promise.resolve().then(() => repo.listBoards(ctx)),
    Promise.resolve().then(() => repo.listDefaultTabDismissals(ctx)),
  ]);
  const boards = boardsResult.status === "fulfilled" && Array.isArray(boardsResult.value)
    ? boardsResult.value
    : [];
  const dismissals = dismissalsResult.status === "fulfilled" && Array.isArray(dismissalsResult.value)
    ? dismissalsResult.value
    : [];
  return {
    boardNavKeys: boardNavKeysFrom(boards),
    userTabs: sidebarUserTabsFrom(boards),
    dismissedSources: dismissedSourcesFrom(dismissals, boards),
  };
}
