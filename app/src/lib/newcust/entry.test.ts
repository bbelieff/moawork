import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Ctx } from "@/lib/types";
import { BoardsService } from "@/lib/boards";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_USER_MEMBER, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { NEW_LEAD_TAB, ensureDefaultTab } from "@/lib/default-tabs";
import { resolveExistingNewcustBoard } from "./entry";

/**
 * ⚠ 시드 조직(`SEED_ORG_ID`)을 쓰지 않는다 — 로컬 dev 시드가 이제 «신규리드 관리» 데모 보드를
 * 이미 갖고 있다(BBE-145 · `seed.ts` `SEED_BOARD_NEW_LEAD`). 같은 조직에서 같은 이름 보드를
 * 하나 더 만들면 conflict 판정과 뒤섞인다. 이 테스트들은 보드 개수를 직접 통제해야 하므로
 * 시드가 닿지 않는 별도 조직 id 를 쓴다.
 */
const TEST_ORG_ID = "org-newcust-entry-test";

function owner(): Ctx {
  return {
    user: { id: SEED_USER_OWNER, email: "owner@example.test", name: "대표", avatar_url: null, created_at: "" },
    org: { id: TEST_ORG_ID, name: "예시 회사", plan_tier: "t1_3", created_at: "" },
    role: "owner",
    scope: "all",
  } as Ctx;
}

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

beforeEach(() => resetDb());

describe("resolveExistingNewcustBoard", () => {
  it("기존 신규리드 보드가 하나일 때만 그 id를 반환한다", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    const created = repo.createBoard(ctx, { name: NEW_LEAD_TAB.name });
    const result = resolveExistingNewcustBoard(ctx, repo);
    const boards = new BoardsService(repo).listBoards(ctx);

    expect(result).toEqual({ kind: "ready", boardId: created.id });
    expect(boards.filter((board) => board.name === NEW_LEAD_TAB.name)).toHaveLength(1);
  });

  it("동일 이름 보드가 둘이면 임의 선택하지 않고 conflict를 반환한다", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    repo.createBoard(ctx, { name: NEW_LEAD_TAB.name });
    repo.createBoard(ctx, { name: NEW_LEAD_TAB.name });

    expect(resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "conflict" });
  });

  /**
   * ★ BBE-156 회귀 가드 — 제품 경로는 먼데이 복제 보드(구조 팩 이름)를 더 이상 추론하지
   * 않는다. BBE-156 이 이 함수를 일부러 끊어 둔 것을 이 카드가 이어받으면서, 그 카드가
   * 지키려던 안전(먼데이 이름을 다시 보지 않는다)까지 함께 지킨다는 것을 기계로 고정한다.
   */
  it("먼데이 원본 이름의 보드는 추론하지 않는다 — 이름이 같아도 신규리드 대상이 아니다", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    repo.createBoard(ctx, { name: "🔥신규고객" });

    expect(resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "missing" });
  });

  it("먼데이 원본 이름 보드가 여럿이어도 이관 대상을 임의 선택하지 않는다(=missing)", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    repo.createBoard(ctx, { name: "🔥신규고객" });
    repo.createBoard(ctx, { name: "🔥신규고객" });

    expect(resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "missing" });
  });

  /**
   * ★ 회귀 가드 (BBE-145 · A′ 판정) — belie 가 프로덕션에서 실제로 부딪힌 막다른 길이다.
   * 워크스페이스 생성 경로(`bootstrapNewWorkspace` 가 아니라 `ensureDefaultTab` 직접 —
   * 이 카드가 아직 생성 훅에 안 이어졌다면 이 테스트가 «잇지 않았다» 를 스스로 증명한다)로
   * 심은 보드를 `/newcust` 진입점이 실제로 찾아야 한다. 옛 구조 팩 이름으로 찾던 시절엔
   * 이 테스트가 «missing» 을 돌려줬을 것이다 — 그게 belie 가 본 화면이었다.
   */
  it("D76 기본 탭으로 심은 보드를 실제로 찾는다 — 옛 구조 팩 이름이 아니다", () => {
    const ctx = owner();
    const repo = getBoardsRepo();
    const { boardId } = ensureDefaultTab(ctx, NEW_LEAD_TAB, repo);

    expect(resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "ready", boardId });
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
