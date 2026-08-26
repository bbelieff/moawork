import { beforeEach, describe, expect, it } from "vitest";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
import { BoardsService } from "./service";

const ctx = {
  org: { id: "org-detail", name: "상세 테스트" },
  user: { id: "user-owner", name: "대표" },
  role: "owner",
  scope: "all",
} as Ctx;

describe("#528 상세 전용 필드 add → edit → reload", () => {
  beforeEach(() => resetDb());

  it("표 컬럼이 아닌 상세 key도 배치 안에서는 재조회되고 표 컬럼에는 생기지 않는다", async () => {
    const repo = new LocalBoardsRepo();
    const board = repo.createBoard(ctx, { name: "고객", source: null });
    const group = repo.createGroup(ctx, board.id, { name: "신규" });
    const item = repo.createItem(ctx, board.id, { title: "대한정밀", group_id: group.id });
    repo.setGroupDetailLayout(ctx, group.id, [
      { key: "detail_credit_grade", source: "detail", label: "신용등급", type: "text" },
    ]);
    repo.setValues(ctx, item.id, { detail_credit_grade: "A" });

    const reloaded = await new BoardsService(toAsyncBoardsRepo(repo)).getItem(ctx, board.id, item.id);
    expect(reloaded.values.detail_credit_grade).toBe("A");
    expect(repo.listColumns(ctx, board.id).some((column) => column.key === "detail_credit_grade")).toBe(false);
  });

  it("현재 상세 배치에서 빠진 잔여 key는 다시 표면화하지 않는다", async () => {
    const repo = new LocalBoardsRepo();
    const board = repo.createBoard(ctx, { name: "고객", source: null });
    const group = repo.createGroup(ctx, board.id, { name: "신규" });
    const item = repo.createItem(ctx, board.id, { title: "대한정밀", group_id: group.id });
    repo.setGroupDetailLayout(ctx, group.id, []);
    repo.setValues(ctx, item.id, { deleted_detail_key: "잔여값" });

    const reloaded = await new BoardsService(toAsyncBoardsRepo(repo)).getItem(ctx, board.id, item.id);
    expect(reloaded.values.deleted_detail_key).toBeUndefined();
  });
});
