import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import { resetDb } from "./store";
import { LocalBoardsRepo } from "./boardsRepo";

const ctx = {
  org: { id: "org-demo", name: "테스트 회사", plan_tier: "test", created_at: "2026-08-15T00:00:00Z" },
  user: { id: "user-owner", email: null, name: "관리자", avatar_url: null, created_at: "2026-08-15T00:00:00Z" },
  role: "owner",
  scope: "all",
  isPlatformAdmin: false,
} satisfies Ctx;

describe("LocalBoardsRepo BBE-107 저장 계약", () => {
  beforeEach(resetDb);

  it("보드 기본과 그룹 오버라이드를 따로 저장하고 reset은 null로 복원한다", () => {
    const repo = new LocalBoardsRepo();
    const board = repo.createBoard(ctx, { name: "업무" });
    const group = repo.createGroup(ctx, board.id, { name: "진행" });

    repo.setBoardDetailLayout(ctx, board.id, [{ key: "company", source: "column" }]);
    repo.setGroupDetailLayout(ctx, group.id, [{ key: "memo", source: "detail", label: "메모", type: "text" }]);
    expect(repo.getBoard(ctx, board.id)?.detail_layout_jsonb).toEqual([{ key: "company", source: "column" }]);
    expect(repo.listGroups(ctx, board.id)[0].detail_layout_jsonb).toEqual([{ key: "memo", source: "detail", label: "메모", type: "text" }]);

    repo.setGroupDetailLayout(ctx, group.id, null);
    expect(repo.listGroups(ctx, board.id)[0].detail_layout_jsonb).toBeNull();
  });

  it("그룹 왕복 이동과 레이아웃 삭제 뒤에도 값 개수가 그대로다", () => {
    const repo = new LocalBoardsRepo();
    const board = repo.createBoard(ctx, { name: "업무" });
    const a = repo.createGroup(ctx, board.id, { name: "A" });
    const b = repo.createGroup(ctx, board.id, { name: "B" });
    const item = repo.createItem(ctx, board.id, { title: "회사", group_id: a.id, values: { company: "모아", detail_note: "보존" } });
    const before = repo.listValues(ctx, [item.id]);

    repo.updateItem(ctx, item.id, { group_id: b.id });
    repo.setGroupDetailLayout(ctx, b.id, []);
    repo.updateItem(ctx, item.id, { group_id: a.id });

    expect(repo.listValues(ctx, [item.id])).toEqual(before);
    expect(repo.listValues(ctx, [item.id])).toHaveLength(2);
  });

  it("그룹 생성은 max+1이며 재정렬은 같은 보드의 전체 집합만 허용한다", () => {
    const repo = new LocalBoardsRepo();
    const board = repo.createBoard(ctx, { name: "업무" });
    const other = repo.createBoard(ctx, { name: "다른 업무" });
    const a = repo.createGroup(ctx, board.id, { name: "A", sortOrder: 7 });
    const b = repo.createGroup(ctx, board.id, { name: "B" });
    const outside = repo.createGroup(ctx, other.id, { name: "외부" });
    expect(b.sort_order).toBe(8);
    expect(repo.reorderGroups(ctx, board.id, [b.id, a.id]).map((group) => group.id)).toEqual([b.id, a.id]);
    expect(() => repo.reorderGroups(ctx, board.id, [a.id, outside.id])).toThrow(/현재 보드/u);
  });
});
