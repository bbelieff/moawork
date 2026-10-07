import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import { BOARD_TRASH_RETENTION_DAYS } from "@/lib/boards/types";
import {
  BoardTrashError,
  DefaultTabAlreadyInstalledError,
  DefaultTabDismissedError,
} from "@/lib/boards/trash-errors";
import { db, resetDb } from "./store";
import { LocalBoardsRepo } from "./boardsRepo";

const ctx = {
  org: { id: "org-trash", name: "테스트 회사", plan_tier: "test", created_at: "2026-10-01T00:00:00Z" },
  user: { id: "user-trash", email: null, name: "관리자", avatar_url: null, created_at: "2026-10-01T00:00:00Z" },
  role: "owner",
  scope: "all",
  isPlatformAdmin: false,
} satisfies Ctx;
const foreign: Ctx = { ...ctx, org: { ...ctx.org, id: "org-other" } };
const DEFAULT_SOURCE = "core.default-tab/sample";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("#849 LocalBoardsRepo 탭 만들기", () => {
  beforeEach(resetDb);

  it("사용자 탭은 기본 아이템 「새 아이템」과 사이드바 자리(기본 계약 후)를 갖는다", () => {
    const repo = new LocalBoardsRepo();
    const after = repo.createBoard(ctx, { name: "업무" });
    const before = repo.createBoard(ctx, { name: "상담", nav_section: "before-contract" });

    expect(after.nav_section).toBe("after-contract");
    expect(before.nav_section).toBe("before-contract");
    expect(repo.listGroups(ctx, after.id).map((group) => [group.name, group.sort_order])).toEqual([["새 아이템", 0]]);
  });

  it("기본 탭(source 있음)은 자리도 기본 아이템도 만들지 않는다", () => {
    const repo = new LocalBoardsRepo();
    const board = repo.createBoard(ctx, { name: "기본", source: DEFAULT_SOURCE, nav_section: "before-contract" });

    expect(board.nav_section).toBeNull();
    expect(repo.listGroups(ctx, board.id)).toEqual([]);
  });

  it("모르는 사이드바 자리는 거부한다", () => {
    const repo = new LocalBoardsRepo();
    expect(() => repo.createBoard(ctx, { name: "x", nav_section: "elsewhere" as never })).toThrow(/자리/u);
  });
});

describe("#849 LocalBoardsRepo 휴지통", () => {
  beforeEach(resetDb);

  function boardWithRow(repo: LocalBoardsRepo, source: string | null = null) {
    const board = repo.createBoard(ctx, { name: "지울 탭", source });
    const group = repo.createGroup(ctx, board.id, { name: "진행" });
    const column = repo.createColumn(ctx, board.id, { label: "메모", type: "text" });
    const item = repo.createItem(ctx, board.id, { title: "행", group_id: group.id, values: { [column.key]: "보존" } });
    repo.createView(ctx, board.id, { name: "내 뷰", kind: "table" });
    return { board, group, column, item };
  }

  it("휴지통 탭은 보통 읽기에서 빠지고, 복구하면 행·값·그룹이 그대로 돌아온다", () => {
    const repo = new LocalBoardsRepo();
    const { board, group, column, item } = boardWithRow(repo);

    const trashed = repo.trashBoard(ctx, board.id);
    expect(trashed).toMatchObject({ deleted_by: ctx.user.id, trashed_source: null, source: null });
    expect(trashed.deleted_at).toBeTruthy();
    expect(repo.listBoards(ctx).some((candidate) => candidate.id === board.id)).toBe(false);
    expect(repo.getBoard(ctx, board.id)).toBeUndefined();
    expect(repo.listTrashedBoards(ctx).map((candidate) => candidate.id)).toEqual([board.id]);
    // 다시 보내도 그대로다.
    expect(repo.trashBoard(ctx, board.id).deleted_at).toBe(trashed.deleted_at);

    const restored = repo.restoreBoard(ctx, board.id);
    expect(restored).toMatchObject({ id: board.id, deleted_at: null, deleted_by: null, trashed_source: null, source: null });
    expect(repo.getBoard(ctx, board.id)).toBeDefined();
    expect(repo.listTrashedBoards(ctx)).toEqual([]);
    expect(repo.listItems(ctx, board.id).map((row) => [row.id, row.group_id])).toEqual([[item.id, group.id]]);
    expect(repo.listValues(ctx, [item.id])).toEqual([
      { org_id: ctx.org.id, item_id: item.id, column_key: column.key, value_jsonb: "보존" },
    ]);
  });

  it("기본 탭을 지우면 출처를 바꾸고 «지운 기본 탭» 을 남겨 다시 만들지 않는다", () => {
    const repo = new LocalBoardsRepo();
    const board = repo.createBoard(ctx, { name: "기본", source: DEFAULT_SOURCE });

    const trashed = repo.trashBoard(ctx, board.id);
    expect(trashed.source).toBe(`trash/${board.id}/${DEFAULT_SOURCE}`);
    expect(trashed.trashed_source).toBe(DEFAULT_SOURCE);
    expect(repo.listDefaultTabDismissals(ctx)).toEqual([
      expect.objectContaining({ org_id: ctx.org.id, source: DEFAULT_SOURCE, dismissed_by: ctx.user.id }),
    ]);
    expect(repo.listDefaultTabDismissals(foreign)).toEqual([]);
    expect(() => repo.createBoard(ctx, { name: "기본", source: DEFAULT_SOURCE })).toThrow(DefaultTabDismissedError);

    // 복구하면 원래 출처로 돌아오고 기록도 지운다.
    expect(repo.restoreBoard(ctx, board.id).source).toBe(DEFAULT_SOURCE);
    expect(repo.listDefaultTabDismissals(ctx)).toEqual([]);
  });

  it("같은 기본 탭이 다시 설치돼 있으면 복구를 막는다", () => {
    const repo = new LocalBoardsRepo();
    const old = repo.createBoard(ctx, { name: "기본", source: DEFAULT_SOURCE });
    repo.trashBoard(ctx, old.id);

    expect(repo.clearDefaultTabDismissal(ctx, DEFAULT_SOURCE)).toBe(true);
    expect(repo.clearDefaultTabDismissal(ctx, DEFAULT_SOURCE)).toBe(false);
    const reinstalled = repo.createBoard(ctx, { name: "기본", source: DEFAULT_SOURCE });
    expect(repo.listGroups(ctx, reinstalled.id)).toEqual([]);

    expect(() => repo.restoreBoard(ctx, old.id)).toThrow(DefaultTabAlreadyInstalledError);
    expect(repo.listTrashedBoards(ctx).map((board) => board.id)).toEqual([old.id]);
  });

  it("완전 삭제는 휴지통 탭만, 행·값·컬럼·그룹·뷰까지 지운다", () => {
    const repo = new LocalBoardsRepo();
    const { board, item } = boardWithRow(repo);

    expect(() => repo.purgeBoard(ctx, board.id)).toThrow(BoardTrashError);
    repo.trashBoard(ctx, board.id);
    expect(repo.purgeBoard(ctx, board.id)).toBe(0);

    const d = db();
    expect(d.boards.some((candidate) => candidate.id === board.id)).toBe(false);
    expect(d.boardItems.some((row) => row.board_id === board.id)).toBe(false);
    expect(d.itemValues.some((value) => value.item_id === item.id)).toBe(false);
    expect(d.boardColumns.some((column) => column.board_id === board.id)).toBe(false);
    expect(d.boardGroups.some((group) => group.board_id === board.id)).toBe(false);
    expect(d.boardViews.some((view) => view.board_id === board.id)).toBe(false);
    expect(() => repo.purgeBoard(ctx, board.id)).toThrow(BoardTrashError);
  });

  it(`${BOARD_TRASH_RETENTION_DAYS}일 지난 휴지통 탭만 자동 정리한다`, () => {
    const repo = new LocalBoardsRepo();
    const expired = repo.createBoard(ctx, { name: "오래됨" });
    const fresh = repo.createBoard(ctx, { name: "최근" });
    const active = repo.createBoard(ctx, { name: "사용 중" });
    repo.trashBoard(ctx, expired.id).deleted_at = new Date(Date.now() - (BOARD_TRASH_RETENTION_DAYS + 1) * DAY_MS).toISOString();
    repo.trashBoard(ctx, fresh.id).deleted_at = new Date(Date.now() - DAY_MS).toISOString();

    expect(repo.purgeExpiredBoards(foreign)).toBe(0);
    expect(repo.purgeExpiredBoards(ctx)).toBe(1);
    expect(repo.listTrashedBoards(ctx).map((board) => board.id)).toEqual([fresh.id]);
    expect(repo.getBoard(ctx, active.id)).toBeDefined();
  });

  it("지우기 전 개수를 세고, 다른 회사의 탭은 건드리지 못한다", () => {
    const repo = new LocalBoardsRepo();
    const { board } = boardWithRow(repo);
    repo.createItem(ctx, board.id, { title: "둘째 행" });

    expect(repo.readBoardTrashImpact(ctx, board.id)).toEqual({
      groups: 2, rows: 2, memos: 0, files: 0, views: 1, automations: 0, messaging: 0,
    });
    expect(() => repo.readBoardTrashImpact(foreign, board.id)).toThrow(BoardTrashError);
    expect(() => repo.trashBoard(foreign, board.id)).toThrow(BoardTrashError);
    expect(() => repo.restoreBoard(foreign, board.id)).toThrow(BoardTrashError);
    expect(repo.getBoard(ctx, board.id)).toBeDefined();
  });

  it("저장소 파일 정리 대기열은 로컬에서 늘 비어 있다", () => {
    const repo = new LocalBoardsRepo();
    expect(repo.listStoragePurgeQueue()).toEqual([]);
    expect(repo.ackStoragePurge()).toBe(0);
  });
});
