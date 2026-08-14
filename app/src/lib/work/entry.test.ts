import { beforeEach, describe, expect, it } from "vitest";
import { CONTRACT_WORK_TAB, CONTRACT_WORK_TAB_SOURCE, ensureDefaultTab } from "@/lib/default-tabs";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import type { Ctx } from "@/lib/types";
import { resetDb } from "@/lib/repo/local/store";
import { resolveExistingContractWorkBoard } from "./entry";

const ctx = {
  org: { id: "org-work-entry", name: "Test organization" },
  user: { id: "owner-work-entry", name: "Owner", email: "owner@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

beforeEach(() => resetDb());

describe("resolveExistingContractWorkBoard", () => {
  it("selects exactly one board by product source", async () => {
    const local = new LocalBoardsRepo();
    const target = local.createBoard(ctx, { name: "Renamed board", source: CONTRACT_WORK_TAB_SOURCE });
    expect(await resolveExistingContractWorkBoard(ctx, toAsyncBoardsRepo(local))).toEqual({
      kind: "ready",
      boardId: target.id,
    });
  });

  it("does not adopt legacy or same-name boards", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: CONTRACT_WORK_TAB.name, source: null });
    local.createBoard(ctx, { name: CONTRACT_WORK_TAB.name, source: "pack.seoul.policyfund1/work" });
    expect(await resolveExistingContractWorkBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "missing" });
  });

  it("fails closed when the product source is duplicated", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: "A", source: CONTRACT_WORK_TAB_SOURCE });
    local.createBoard(ctx, { name: "B", source: CONTRACT_WORK_TAB_SOURCE });
    expect(await resolveExistingContractWorkBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "conflict" });
  });

  it("resolves the board created by the default installer", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const installed = await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, repo);
    expect(await resolveExistingContractWorkBoard(ctx, repo)).toEqual({
      kind: "ready",
      boardId: installed.boardId,
    });
  });
});
