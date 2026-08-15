import { beforeEach, describe, expect, it } from "vitest";
import { NOTICE_TAB, ensureDefaultTab } from "@/lib/default-tabs";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
import { resolveExistingNoticeBoard } from "./entry";

const ctx = {
  org: { id: "org-notice-entry", name: "테스트 회사" },
  user: { id: "owner", name: "만든 사람", email: "owner@example.test" },
  role: "owner",
  scope: "all",
} as Ctx;

describe("BBE-151 notice product entry", () => {
  beforeEach(() => resetDb());

  it("finds the one board installed from the notice default tab", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const installed = await ensureDefaultTab(ctx, NOTICE_TAB, repo);
    expect(await resolveExistingNoticeBoard(ctx, repo)).toEqual({
      kind: "ready",
      boardId: installed.boardId,
    });
  });

  it("keeps missing and duplicate product sources explicit", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    expect(await resolveExistingNoticeBoard(ctx, repo)).toEqual({ kind: "missing" });
    await local.createBoard(ctx, { name: "공지 1", source: NOTICE_TAB.source });
    await local.createBoard(ctx, { name: "공지 2", source: NOTICE_TAB.source });
    expect(await resolveExistingNoticeBoard(ctx, repo)).toEqual({ kind: "conflict" });
  });
});
