import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { ensureDefaultTab, NEW_LEAD_TAB } from "@/lib/default-tabs";
import { NEWCUST_BOARD_SOURCE, resolveExistingNewcustBoard } from "./entry";

function owner(): Ctx {
  return {
    user: { id: SEED_USER_OWNER, email: "owner@example.test", name: "owner", avatar_url: null, created_at: "" },
    org: { id: "org-newcust-entry-test", name: "example", plan_tier: "t1_3", created_at: "" },
    role: "owner",
    scope: "all",
  } as Ctx;
}

beforeEach(() => resetDb());

describe("resolveExistingNewcustBoard", () => {
  it("제품 경로에서 이름이 같은 보드를 먼데이 원본으로 추론하지 않는다", async () => {
    const ctx = owner();
    const repo = new LocalBoardsRepo();
    repo.createBoard(ctx, { name: "🔥신규고객" });
    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(repo))).toEqual({ kind: "missing" });
  });

  it("source 식별자가 유일하면 해당 보드를 연다", async () => {
    const ctx = owner();
    const repo = new LocalBoardsRepo();
    const target = repo.createBoard(ctx, { name: "이름 무관", source: NEWCUST_BOARD_SOURCE });
    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(repo))).toEqual({ kind: "ready", boardId: target.id });
  });

  it("source 식별자가 중복이면 임의 선택하지 않는다", async () => {
    const ctx = owner();
    const repo = new LocalBoardsRepo();
    repo.createBoard(ctx, { name: "A", source: NEWCUST_BOARD_SOURCE });
    repo.createBoard(ctx, { name: "B", source: NEWCUST_BOARD_SOURCE });
    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(repo))).toEqual({ kind: "conflict" });
  });

  it("호출해도 구조 레코드를 만들지 않는다", async () => {
    const ctx = owner();
    const repo = new LocalBoardsRepo();
    const before = repo.listBoards(ctx);
    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(repo))).toEqual({ kind: "missing" });
    expect(repo.listBoards(ctx)).toEqual(before);
  });
  it("D76 기본 탭을 심으면 안정 source로 즉시 진입한다", async () => {
    const ctx = owner();
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const { boardId } = await ensureDefaultTab(ctx, NEW_LEAD_TAB, repo);

    expect(await resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "ready", boardId });
    expect(local.listBoards(ctx).find((board) => board.id === boardId)?.source).toBe(
      NEWCUST_BOARD_SOURCE,
    );
  });

  it("legacy 이름만 같은 보드는 제품 기본 탭으로 오인하지 않는다", async () => {
    const ctx = owner();
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: NEW_LEAD_TAB.name, source: null });

    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(local))).toEqual({
      kind: "missing",
    });
  });
});
