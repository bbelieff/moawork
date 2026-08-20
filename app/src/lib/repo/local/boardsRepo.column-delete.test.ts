import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import { LocalBoardsRepo } from "./boardsRepo";
import { resetDb } from "./store";

const ctx = {
  org: { id: "org-delete-a", name: "A", plan_tier: "test", created_at: "2026-08-21T00:00:00Z" },
  user: { id: "user-delete-a", email: null, name: "A", avatar_url: null, created_at: "2026-08-21T00:00:00Z" },
  role: "owner",
  scope: "all",
  isPlatformAdmin: false,
} satisfies Ctx;

describe("BBE-196 LocalBoardsRepo 컬럼 소유권", () => {
  beforeEach(() => resetDb());

  it("board A에 board B의 컬럼을 주면 양쪽 모두 변하지 않는다", () => {
    const repo = new LocalBoardsRepo();
    const boardA = repo.createBoard(ctx, { name: "A" });
    const boardB = repo.createBoard(ctx, { name: "B" });
    const columnB = repo.createColumn(ctx, boardB.id, { label: "B 컬럼", type: "text" });
    const beforeA = repo.listColumns(ctx, boardA.id);
    const beforeB = repo.listColumns(ctx, boardB.id);

    expect(repo.deleteColumn(ctx, boardA.id, columnB.id)).toBe(false);
    expect(repo.listColumns(ctx, boardA.id)).toEqual(beforeA);
    expect(repo.listColumns(ctx, boardB.id)).toEqual(beforeB);
  });

  it("다른 조직 board id로는 같은 column id를 지우지 못한다", () => {
    const repo = new LocalBoardsRepo();
    const board = repo.createBoard(ctx, { name: "A" });
    const column = repo.createColumn(ctx, board.id, { label: "보호", type: "text" });
    const other = { ...ctx, org: { ...ctx.org, id: "org-delete-b" } };

    expect(repo.deleteColumn(other, board.id, column.id)).toBe(false);
    expect(repo.listColumns(ctx, board.id)).toEqual([column]);
  });

  it("시스템 보드에 속한 컬럼은 삭제하지 않는다", () => {
    const repo = new LocalBoardsRepo();
    const board = repo.createBoard(ctx, { name: "시스템" });
    const column = repo.createColumn(ctx, board.id, { label: "보호", type: "text" });
    const stored = repo.getBoard(ctx, board.id)!;
    stored.is_system = true;

    expect(repo.deleteColumn(ctx, board.id, column.id)).toBe(false);
    expect(repo.listColumns(ctx, board.id)).toEqual([column]);
  });
});
