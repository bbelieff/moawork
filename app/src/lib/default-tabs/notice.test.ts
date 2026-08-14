import { describe, expect, it } from "vitest";
import { BoardsService } from "@/lib/boards/service";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
import { ensureDefaultTab } from "./install";
import { NOTICE_GROUPS, NOTICE_TAB } from "./notice";

const ctx = {
  org: { id: "org-notice", name: "테스트 회사" },
  user: { id: "owner-1", name: "만든 사람", email: "owner@example.com" },
  role: "owner",
  scope: "all",
} as Ctx;

describe("BBE-151 notice default tab", () => {
  it("keeps the complete five-group, ten-column structure", () => {
    expect(NOTICE_TAB.groups.map((group) => group.name)).toEqual(Object.values(NOTICE_GROUPS));
    expect(NOTICE_TAB.columns).toHaveLength(10);
    expect(NOTICE_TAB.columns.map(({ label, type }) => [label, type])).toEqual([
      ["대상", "people"], ["읽음", "calc"], ["작성자", "person"], ["공문PDF", "file"],
      ["내용 정리", "longtext"], ["점수 미달인 업체", "select"], ["세금 미납인 업체", "select"],
      ["미선정 업체", "select"], ["상태", "status"], ["작성일", "date"],
    ]);
  });

  it("pins status and maps 공지완료 to the completed group", async () => {
    resetDb();
    const repo = new LocalBoardsRepo();
    const asyncRepo = toAsyncBoardsRepo(repo);
    const installed = await ensureDefaultTab(ctx, NOTICE_TAB, asyncRepo);
    const status = repo.listColumns(ctx, installed.boardId).find((column) => column.key === "status")!;
    expect(status.rightPinned).toBe(true);
    expect(status.move_rule_jsonb).toEqual({ 공지완료: installed.groupIds[NOTICE_GROUPS.completed] });

    const item = repo.createItem(ctx, installed.boardId, { title: "새 공지" });
    await new BoardsService(asyncRepo).setCells(ctx, installed.boardId, item.id, { status: "공지완료" });
    expect(repo.getItem(ctx, item.id)?.group_id).toBe(installed.groupIds[NOTICE_GROUPS.completed]);
  });

  it("marks calculated and automatic values read-only", () => {
    for (const key of ["read_count", "author", "official_pdf", "created_on"]) {
      expect(NOTICE_TAB.columns.find((column) => column.key === key)?.readOnly).toBe(true);
    }
  });

  it("contains no customer-specific people or company values", () => {
    expect(JSON.stringify(NOTICE_TAB)).not.toMatch(/카뮈|이대표|박정화|대한정밀|미래로지스|우진산업/);
  });
});
