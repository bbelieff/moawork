import { beforeEach, describe, expect, it } from "vitest";
import { CONTACT_TAB, CONTACT_TAB_SOURCE, ensureDefaultTab } from "@/lib/default-tabs";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { getRepo } from "@/lib/repo";
import type { Ctx } from "@/lib/types";
import { resolveExistingContactBoard } from "./entry";

const ctx = {
  org: { id: "org-contact-entry", name: "테스트 회사" },
  user: { id: "member-a", name: "계정 A", email: "a@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

beforeEach(() => {
  resetDb();
  getRepo().addMember(ctx.org.id, {
    id: ctx.user.id,
    name: ctx.user.name,
    email: ctx.user.email,
    avatar_url: null,
    created_at: "2026-08-14T00:00:00Z",
  }, "owner", "all");
});

describe("resolveExistingContactBoard", () => {
  it("제품 source가 유일할 때만 연다", async () => {
    const local = new LocalBoardsRepo();
    const target = local.createBoard(ctx, { name: "이름은 바꿀 수 있음", source: CONTACT_TAB_SOURCE });
    expect(await resolveExistingContactBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "ready", boardId: target.id });
  });

  it("이름만 같은 보드와 과거 구조 팩 보드는 제품 탭으로 오인하지 않는다", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: CONTACT_TAB.name, source: null });
    local.createBoard(ctx, { name: CONTACT_TAB.name, source: "pack.seoul.policyfund1/contact" });
    expect(await resolveExistingContactBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "missing" });
  });

  it("source 중복이면 임의 선택하지 않는다", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: "A", source: CONTACT_TAB_SOURCE });
    local.createBoard(ctx, { name: "B", source: CONTACT_TAB_SOURCE });
    expect(await resolveExistingContactBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "conflict" });
  });

  it("기본 탭 보장 직후 같은 board id로 진입한다", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const result = await ensureDefaultTab(ctx, CONTACT_TAB, repo);
    expect(await resolveExistingContactBoard(ctx, repo)).toEqual({ kind: "ready", boardId: result.boardId });
  });

  it("조회 호출은 구조를 만들지 않는다", async () => {
    const local = new LocalBoardsRepo();
    const before = local.listBoards(ctx);
    expect(await resolveExistingContactBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "missing" });
    expect(local.listBoards(ctx)).toEqual(before);
  });
});
