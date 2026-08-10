import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Ctx } from "@/lib/types";
import { BoardsService } from "@/lib/boards";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_MEMBER, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { SEOUL_NEWCUST_BOARD } from "@/lib/structure-packs";
import { resolveExistingNewcustBoard } from "./entry";

function owner(): Ctx {
  return {
    user: { id: SEED_USER_OWNER, email: "owner@example.test", name: "대표", avatar_url: null, created_at: "" },
    org: { id: SEED_ORG_ID, name: "예시 회사", plan_tier: "t1_3", created_at: "" },
    role: "owner",
    scope: "all",
  } as Ctx;
}

beforeEach(() => resetDb());

function member(): Ctx {
  return { ...owner(), user: { ...owner().user, id: SEED_USER_MEMBER }, role: "member", scope: "assigned" } as Ctx;
}

function structureCounts(ctx: Ctx) {
  const repo = getBoardsRepo();
  const boards = repo.listBoards(ctx);
  return {
    boards: boards.length,
    groups: boards.reduce((count, board) => count + repo.listGroups(ctx, board.id).length, 0),
    columns: boards.reduce((count, board) => count + repo.listColumns(ctx, board.id).length, 0),
    views: boards.reduce((count, board) => count + repo.listViews(ctx, board.id).length, 0),
  };
}

describe("resolveExistingNewcustBoard", () => {
  it("기존 신규업체 보드가 하나일 때만 그 id를 반환한다", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    const created = repo.createBoard(ctx, { name: SEOUL_NEWCUST_BOARD.name });
    const result = resolveExistingNewcustBoard(ctx, repo);
    const boards = new BoardsService(repo).listBoards(ctx);

    expect(result).toEqual({ kind: "ready", boardId: created.id });
    expect(boards.filter((board) => board.name === SEOUL_NEWCUST_BOARD.name)).toHaveLength(1);
  });

  it("동일 이름 보드가 둘이면 임의 선택하지 않고 conflict를 반환한다", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    repo.createBoard(ctx, { name: SEOUL_NEWCUST_BOARD.name });
    repo.createBoard(ctx, { name: SEOUL_NEWCUST_BOARD.name });

    expect(resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "conflict" });
  });

  it("member가 보드 0개로 방문해도 모든 구조 레코드를 만들지 않는다", () => {
    const ctx = member();
    const before = structureCounts(ctx);

    expect(resolveExistingNewcustBoard(ctx)).toEqual({ kind: "missing" });
    expect(structureCounts(ctx)).toEqual(before);
  });

  it("신규업체 메뉴와 서버 진입점이 공용 보드 셸의 canonical URL로 연결된다", () => {
    const nav = readFileSync(resolve(process.cwd(), "src/components/shell/nav-items.ts"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "src/app/(app)/newcust/page.tsx"), "utf8");

    // icon 리터럴은 BBE-126(2026-08-10)에서 이모지 → SVG 심볼 키로 교체됐다(D43). 이 테스트가 지키는 계약은
    // "신규업체 메뉴가 /newcust 로 연결됨"이므로 라벨·href만 고정하고 아이콘 표현 방식은 자유롭게 둔다.
    expect(nav).toContain('label: "신규업체"');
    expect(nav).toMatch(/label: "신규업체"[^}]*href: "\/newcust"/);
    expect(page).toContain('redirect(`/boards/${encodeURIComponent(result.boardId)}${query}`)');
    expect(page).toContain("GET 요청은 어떤 보드도 만들지 않는다");
    expect(page).not.toContain("StageBoardView");
  });
});
