import { describe, expect, it, vi } from "vitest";

import {
  boardNavKeysFrom,
  dismissedSourcesFrom,
  loadSidebarBoards,
  sidebarUserTabsFrom,
} from "./board-nav-map";
import { TAB_SOURCE_NAV_KEY } from "@/components/shell/active-nav";
import type { Board, DefaultTabDismissal } from "@/lib/boards/types";
import { NOTICE_BOARD_NAME } from "@/lib/notices/types";
import { SECTION_PRESET_SOURCE } from "@/lib/presets/section-presets";
import type { Ctx } from "@/lib/types";

/**
 * 사이드바가 «지금 이 보드가 어느 탭인가» 를 아는 지도 (#588 ⑥) + 사용자 탭·지운 기본 탭 (#849).
 *
 * ★ 이 파일이 사이드바 활성 표시의 뿌리인데 검사가 0건이었다.
 *   특히 「못 읽어도 셸이 안 죽는다」는 주석에만 있고 아무도 재지 않았다.
 *   셸은 «모든 화면의 뼈대» 라 여기서 던지면 앱 전체가 500 이다.
 */
const ctx = { user: { id: "u" }, org: { id: "org-1" }, role: "owner", scope: "all" } as Ctx;

function board(id: string, source: string | null, extra: Partial<Board> = {}): Board {
  return { id, org_id: "org-1", name: id, source, icon: null, sort_order: 0, ...extra } as unknown as Board;
}

function dismissal(source: string): DefaultTabDismissal {
  return { org_id: "org-1", source, dismissed_at: "2026-10-06T00:00:00.000Z", dismissed_by: null };
}

const NEW_LEAD_SOURCE = Object.keys(TAB_SOURCE_NAV_KEY)[0];
const CONTACT_SOURCE = "core.default-tab/contact";

function repoOf(boards: Board[] | Error, dismissals: DefaultTabDismissal[] | Error = []) {
  return {
    listBoards: vi.fn(async () => {
      if (boards instanceof Error) throw boards;
      return boards;
    }),
    listDefaultTabDismissals: vi.fn(async () => {
      if (dismissals instanceof Error) throw dismissals;
      return dismissals;
    }),
  };
}

describe("보드 → 탭 지도", () => {
  it("기본 탭인 보드는 id → 그 메뉴 키로 만든다", () => {
    const map = boardNavKeysFrom([board("b-1", NEW_LEAD_SOURCE)]);
    expect(map).toEqual({ "b-1": TAB_SOURCE_NAV_KEY[NEW_LEAD_SOURCE] });
  });

  it("#849 사용자 탭(source 없음)은 «board:<id>» — 그 보드에서는 사이드바의 자기 줄 하나만 켜진다", () => {
    expect(boardNavKeysFrom([board("b-3", null)])).toEqual({ "b-3": "board:b-3" });
  });

  it("★ 기본 탭도 사용자 탭도 아닌 보드는 안 넣는다 — 넣으면 아무 보드에서나 탭이 켜진 것처럼 보인다", () => {
    expect(boardNavKeysFrom([board("b-2", "custom.something")])).toEqual({});
    expect(boardNavKeysFrom([board("b-4", `${SECTION_PRESET_SOURCE}x`)])).toEqual({});
    expect(boardNavKeysFrom([board("b-5", "constructor")])).toEqual({});
    expect(boardNavKeysFrom([])).toEqual({});
  });

  it("휴지통 탭은 넣지 않는다(listBoards 가 거르지만 마지막 문에서 한 번 더)", () => {
    expect(boardNavKeysFrom([
      board("b-1", NEW_LEAD_SOURCE, { deleted_at: "2026-10-07T00:00:00.000Z" }),
      board("b-2", null, { deleted_at: "2026-10-07T00:00:00.000Z" }),
    ])).toEqual({});
  });

  it("네 기본 탭을 모두 담는다", () => {
    const boards = Object.keys(TAB_SOURCE_NAV_KEY).map((source, i) => board(`b-${i}`, source));
    expect(Object.keys(boardNavKeysFrom(boards))).toHaveLength(Object.keys(TAB_SOURCE_NAV_KEY).length);
  });
});

describe("#849 사용자 탭 줄 데이터", () => {
  it("source 없는 살아 있는 탭만, sort_order 순으로 — 기본 탭·프리셋·휴지통은 빠진다", () => {
    const tabs = sidebarUserTabsFrom([
      board("late", null, { name: "계약 진행", sort_order: 30, nav_section: "after-contract" }),
      board("default", NEW_LEAD_SOURCE, { sort_order: 1 }),
      board("preset", `${SECTION_PRESET_SOURCE}group/abc`, { sort_order: 2 }),
      board("trashed", null, { sort_order: 3, deleted_at: "2026-10-07T00:00:00.000Z" }),
      board("early", null, { name: "리드 접수", sort_order: 10, nav_section: "before-contract", icon: "📋" }),
      board("tie", null, { name: "같은 순서", sort_order: 30 }),
    ]);
    expect(tabs).toEqual([
      { id: "early", name: "리드 접수", icon: "📋", navSection: "before-contract" },
      { id: "late", name: "계약 진행", icon: null, navSection: "after-contract" },
      // 자리가 없던 탭(169 이전)은 계약 후 — 받은 순서를 지킨다.
      { id: "tie", name: "같은 순서", icon: null, navSection: "after-contract" },
    ]);
  });

  it("★ 옛 공지 보드(source 없음 + 이름 «공지사항»)는 사용자 탭이 아니다 — 공지 서비스·RLS 061 과 같은 규칙", () => {
    const boards = [
      board("legacy-notice", null, { name: NOTICE_BOARD_NAME }),
      board("u-1", null, { name: "영업 파이프라인" }),
    ];
    expect(sidebarUserTabsFrom(boards).map((tab) => tab.id)).toEqual(["u-1"]);
    // 지도에도 «board:<id>» 로 넣지 않는다(예전처럼 아무 메뉴도 켜지 않는다).
    expect(boardNavKeysFrom(boards)).toEqual({ "u-1": "board:u-1" });
    // 이름만 같고 source 가 있는 보드는 사용자 탭 판정 대상이 아니다.
    expect(sidebarUserTabsFrom([board("n", "core.notice", { name: NOTICE_BOARD_NAME })])).toEqual([]);
  });

  it("모르는 자리 값은 계약 후로 맞춘다", () => {
    const [tab] = sidebarUserTabsFrom([board("x", null, { nav_section: "sidebar-top" as never })]);
    expect(tab.navSection).toBe("after-contract");
  });
});

describe("#849 지운 기본 탭", () => {
  it("기록된 source 를 한 번씩만 돌려준다", () => {
    expect(dismissedSourcesFrom([dismissal(CONTACT_SOURCE), dismissal(CONTACT_SOURCE)], [])).toEqual([CONTACT_SOURCE]);
  });

  it("★ 같은 source 의 탭이 지금 살아 있으면 숨기지 않는다 — 있는 탭이 메뉴에서 사라지면 안 된다", () => {
    expect(dismissedSourcesFrom([dismissal(CONTACT_SOURCE)], [board("c", CONTACT_SOURCE)])).toEqual([]);
    // 휴지통에 있는 그 탭은 «살아 있지 않다».
    expect(dismissedSourcesFrom(
      [dismissal(CONTACT_SOURCE)],
      [board("c", CONTACT_SOURCE, { deleted_at: "2026-10-07T00:00:00.000Z" })],
    )).toEqual([CONTACT_SOURCE]);
  });
});

describe("셸 로더 — 한 번의 보드 읽기", () => {
  it("보드를 읽어 지도·사용자 탭·지운 기본 탭을 함께 만든다", async () => {
    const repo = repoOf(
      [board("b-1", NEW_LEAD_SOURCE), board("u-1", null, { name: "영업 파이프라인", nav_section: "before-contract" })],
      [dismissal(CONTACT_SOURCE)],
    );
    await expect(loadSidebarBoards(ctx, repo)).resolves.toEqual({
      boardNavKeys: { "b-1": TAB_SOURCE_NAV_KEY[NEW_LEAD_SOURCE], "u-1": "board:u-1" },
      userTabs: [{ id: "u-1", name: "영업 파이프라인", icon: null, navSection: "before-contract" }],
      dismissedSources: [CONTACT_SOURCE],
    });
    expect(repo.listBoards).toHaveBeenCalledTimes(1);
    expect(repo.listDefaultTabDismissals).toHaveBeenCalledTimes(1);
  });

  it("보드 목록과 지운 기록을 «같이» 출발시킨다 — 앞엣것을 기다렸다가 뒤엣것을 읽지 않는다", async () => {
    let releaseBoards!: (boards: Board[]) => void;
    const repo = {
      listBoards: vi.fn(() => new Promise<Board[]>((resolve) => { releaseBoards = resolve; })),
      listDefaultTabDismissals: vi.fn(async () => [] as DefaultTabDismissal[]),
    };
    const pending = loadSidebarBoards(ctx, repo);
    await vi.waitFor(() => expect(repo.listDefaultTabDismissals).toHaveBeenCalled());
    expect(repo.listBoards).toHaveBeenCalled();
    releaseBoards([]);
    await expect(pending).resolves.toEqual({ boardNavKeys: {}, userTabs: [], dismissedSources: [] });
  });

  /**
   * ★ 이것이 이 파일에서 제일 중요한 검사다.
   *   셸은 모든 화면의 뼈대라, 여기서 예외가 새면 «앱 전체가 500» 이 된다.
   *   활성 표시가 안 되는 것과 앱이 안 열리는 것은 비교할 수 없는 차이다.
   */
  it("★ 보드를 못 읽어도 던지지 않는다 — 지도·사용자 탭만 비운다", async () => {
    const repo = repoOf(new Error("db down"), [dismissal(CONTACT_SOURCE)]);
    await expect(loadSidebarBoards(ctx, repo)).resolves.toEqual({
      boardNavKeys: {},
      userTabs: [],
      dismissedSources: [CONTACT_SOURCE],
    });
  });

  it("★ 지운 기록을 못 읽어도 던지지 않는다 — 기본 메뉴를 숨기지 않을 뿐이다", async () => {
    const repo = repoOf([board("u-1", null)], new Error("relation missing"));
    await expect(loadSidebarBoards(ctx, repo)).resolves.toEqual({
      boardNavKeys: { "u-1": "board:u-1" },
      userTabs: [{ id: "u-1", name: "u-1", icon: null, navSection: "after-contract" }],
      dismissedSources: [],
    });
  });

  it("★ 둘 다 못 읽거나 동기 예외가 나도 빈 값이다", async () => {
    const repo = {
      listBoards: vi.fn(() => { throw new Error("sync boom"); }),
      listDefaultTabDismissals: vi.fn(async () => { throw new Error("db down"); }),
    };
    await expect(loadSidebarBoards(ctx, repo as never)).resolves.toEqual({
      boardNavKeys: {},
      userTabs: [],
      dismissedSources: [],
    });
  });
});
