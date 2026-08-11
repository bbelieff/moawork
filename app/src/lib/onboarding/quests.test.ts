import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/lib/repo/local/store";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import type { Ctx } from "@/lib/types";
import { JUDGES, isKnownJudgeKind, judgeQuest, type QuestDef } from "./quests";

const ORG_A = "onb-org-a";
const ORG_B = "onb-org-b";

function ctxFor(orgId: string): Ctx {
  return {
    user: { id: "u1", email: "t@demo", name: "t", avatar_url: null, created_at: "" },
    org: { id: orgId, name: "org", plan_tier: "t1_3", created_at: "" },
    role: "owner",
    scope: "all",
  } as Ctx;
}

const repo = () => getBoardsRepo();

function quest(judgeKind: string, params: Record<string, unknown> = {}): QuestDef {
  return { questKey: "q", title: "t", description: null, judgeKind, judgeParams: params };
}

beforeEach(() => {
  resetDb();
});

describe("isKnownJudgeKind", () => {
  it("알려진 judge_kind 3종만 참이다", () => {
    expect(isKnownJudgeKind("item_created")).toBe(true);
    expect(isKnownJudgeKind("item_in_group")).toBe(true);
    expect(isKnownJudgeKind("column_value_set")).toBe(true);
    expect(isKnownJudgeKind("no_such_kind")).toBe(false);
  });

  it("JUDGES 테이블과 어휘가 정확히 일치한다", () => {
    expect(Object.keys(JUDGES).sort()).toEqual(["column_value_set", "item_created", "item_in_group"]);
  });
});

describe("judgeQuest — item_created", () => {
  it("항목이 하나도 없으면 미통과", () => {
    const ctx = ctxFor(ORG_A);
    repo().createBoard(ctx, { name: "board" });
    expect(judgeQuest(ctx, repo(), quest("item_created"))).toBe(false);
  });

  it("항목을 하나 만들면 통과", () => {
    const ctx = ctxFor(ORG_A);
    const board = repo().createBoard(ctx, { name: "board" });
    repo().createItem(ctx, board.id, { title: "item" });
    expect(judgeQuest(ctx, repo(), quest("item_created"))).toBe(true);
  });

  it("다른 조직에 항목을 만들어도 이 조직은 여전히 미통과다 — 격리 확인", () => {
    const ctxA = ctxFor(ORG_A);
    const ctxB = ctxFor(ORG_B);
    const boardB = repo().createBoard(ctxB, { name: "board-b" });
    repo().createItem(ctxB, boardB.id, { title: "item-in-b" });

    repo().createBoard(ctxA, { name: "board-a" });
    expect(judgeQuest(ctxA, repo(), quest("item_created"))).toBe(false);
    expect(judgeQuest(ctxB, repo(), quest("item_created"))).toBe(true);
  });

  it("알 수 없는 judge_kind 는 미통과로 닫힌다", () => {
    const ctx = ctxFor(ORG_A);
    expect(judgeQuest(ctx, repo(), quest("mystery"))).toBe(false);
  });
});

describe("judgeQuest — item_in_group", () => {
  it("항목이 첫 그룹에 그대로 있으면 미통과", () => {
    const ctx = ctxFor(ORG_A);
    const board = repo().createBoard(ctx, { name: "board" });
    const g1 = repo().createGroup(ctx, board.id, { name: "시작" });
    repo().createGroup(ctx, board.id, { name: "다음" });
    const item = repo().createItem(ctx, board.id, { title: "item" });
    repo().updateItem(ctx, item.id, { group_id: g1.id });
    expect(judgeQuest(ctx, repo(), quest("item_in_group"))).toBe(false);
  });

  it("항목을 다른(첫 그룹이 아닌) 그룹으로 옮기면 통과", () => {
    const ctx = ctxFor(ORG_A);
    const board = repo().createBoard(ctx, { name: "board" });
    const g1 = repo().createGroup(ctx, board.id, { name: "시작" });
    const g2 = repo().createGroup(ctx, board.id, { name: "다음" });
    void g1;
    const item = repo().createItem(ctx, board.id, { title: "item" });
    repo().updateItem(ctx, item.id, { group_id: g2.id });
    expect(judgeQuest(ctx, repo(), quest("item_in_group"))).toBe(true);
  });

  it("그룹이 없는 보드는 미통과", () => {
    const ctx = ctxFor(ORG_A);
    const board = repo().createBoard(ctx, { name: "board" });
    repo().createItem(ctx, board.id, { title: "item" });
    expect(judgeQuest(ctx, repo(), quest("item_in_group"))).toBe(false);
  });
});

describe("judgeQuest — column_value_set", () => {
  it("값을 채우지 않으면 미통과", () => {
    const ctx = ctxFor(ORG_A);
    const board = repo().createBoard(ctx, { name: "board" });
    repo().createColumn(ctx, board.id, { label: "메모", type: "text" });
    repo().createItem(ctx, board.id, { title: "item" });
    expect(judgeQuest(ctx, repo(), quest("column_value_set"))).toBe(false);
  });

  it("컬럼 값을 채우면 통과", () => {
    const ctx = ctxFor(ORG_A);
    const board = repo().createBoard(ctx, { name: "board" });
    const col = repo().createColumn(ctx, board.id, { label: "메모", type: "text" });
    const item = repo().createItem(ctx, board.id, { title: "item" });
    repo().setValues(ctx, item.id, { [col.key]: "연습 메모" });
    expect(judgeQuest(ctx, repo(), quest("column_value_set"))).toBe(true);
  });

  it("빈 문자열은 채운 것으로 치지 않는다", () => {
    const ctx = ctxFor(ORG_A);
    const board = repo().createBoard(ctx, { name: "board" });
    const col = repo().createColumn(ctx, board.id, { label: "메모", type: "text" });
    const item = repo().createItem(ctx, board.id, { title: "item" });
    repo().setValues(ctx, item.id, { [col.key]: "" });
    expect(judgeQuest(ctx, repo(), quest("column_value_set"))).toBe(false);
  });
});
