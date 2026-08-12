/**
 * 새 워크스페이스는 태어날 때 구조를 갖고 있다 — BBE-46 · D76.
 *
 * 카드 원문(2026-08-05)의 수용기준은 «새 조직 **설치** 시» 였다. D76 이 그 «설치» 개념을
 * 폐기했으므로 기준을 다시 잡는다 — **«생성» 시 이미 있어야 한다.**
 *
 * 여기서 «생성» 은 `getRepo().createOrg()` 다(앱에서 워크스페이스를 만드는 유일한 경로).
 * 그래서 이 테스트는 팩을 직접 부르지 않고 **실제 생성 경로를 그대로 태운다** —
 * 그러지 않으면 «팩이 잘 도는가» 만 증명하고 «생성하면 있는가» 는 증명하지 못한다.
 * (그 구분을 놓친 것이 진단서 §1.2 가 지목한 「목업 86/86 PASS」와 같은 종류의 착각이다.)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { SEOUL_STRUCTURE_PACK, allSectionPresets } from "@/lib/structure-packs";
import type { Ctx, User } from "@/lib/types";
import { bootstrapNewWorkspace } from ".";

const CREATOR: User = {
  id: "usr-bootstrap-owner",
  name: "만든 사람",
  email: "owner@example.com",
} as unknown as User;

/** 실제 생성 경로 — `onboarding/page.tsx` 의 `createOrg()` 가 하는 것과 같은 순서. */
function createWorkspace(name = "새 회사"): Ctx {
  const repo = getRepo();
  repo.upsertUser(CREATOR);
  const { org } = repo.createOrg({ name }, CREATOR);
  const ctx = { user: CREATOR, org, role: "owner", scope: "all" } as unknown as Ctx;
  bootstrapNewWorkspace(ctx);
  return ctx;
}

beforeEach(() => {
  resetDb();
});

describe("생성하면 구조가 이미 있다 (D76 — «설치» 단계 없음)", () => {
  it("보드 3개가 팩 순서·이름 그대로 생긴다", () => {
    const ctx = createWorkspace();

    expect(getBoardsRepo().listBoards(ctx).map((board) => board.name)).toEqual(
      SEOUL_STRUCTURE_PACK.boards.map((board) => board.name),
    );
  });

  it("보드마다 컬럼이 팩 정의 개수·순서 그대로 생긴다", () => {
    const ctx = createWorkspace();
    const repo = getBoardsRepo();
    const boards = repo.listBoards(ctx);

    for (const [index, packBoard] of SEOUL_STRUCTURE_PACK.boards.entries()) {
      const columns = repo.listColumns(ctx, boards[index].id);
      expect(columns.map((column) => column.label), packBoard.slug).toEqual(
        packBoard.columns.map((column) => column.label),
      );
    }
  });

  it("그룹에 색과 순서가 들어간다 — 수용기준의 «색·순서까지»", () => {
    const ctx = createWorkspace();
    const repo = getBoardsRepo();

    for (const board of repo.listBoards(ctx)) {
      const groups = repo.listGroups(ctx, board.id);
      expect(groups.length, `${board.name} 그룹 0개`).toBeGreaterThan(0);
      // 색이 전부 hex 다.
      for (const group of groups) expect(group.color, `${board.name}/${group.name}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      // 순서가 0부터 빈틈없이 이어진다.
      expect(groups.map((group) => group.sort_order)).toEqual(groups.map((_, i) => i));
    }
  });

  it("★ 데이터는 0 이다 — 구조만 심고 행은 만들지 않는다 (D72)", () => {
    const ctx = createWorkspace();
    const repo = getBoardsRepo();

    for (const board of repo.listBoards(ctx)) {
      expect(repo.listItems(ctx, board.id), `${board.name} 에 행이 생겼다`).toHaveLength(0);
    }
  });

  it("두 번 불려도 두 벌 생기지 않는다 — 멱등", () => {
    const ctx = createWorkspace();
    const before = getBoardsRepo().listBoards(ctx).length;

    const second = bootstrapNewWorkspace(ctx);

    expect(getBoardsRepo().listBoards(ctx)).toHaveLength(before);
    expect(second.structure.boards).toHaveLength(0);
    expect(second.structure.skipped).toEqual(SEOUL_STRUCTURE_PACK.boards.map((board) => board.slug));
  });

  it("다른 워크스페이스의 구조를 보지 않는다 — 조직 경계", () => {
    const first = createWorkspace("회사 가");
    const second = createWorkspace("회사 나");
    const repo = getBoardsRepo();

    expect(repo.listBoards(first).map((b) => b.id).sort()).not.toEqual(
      repo.listBoards(second).map((b) => b.id).sort(),
    );
    expect(repo.listBoards(second)).toHaveLength(SEOUL_STRUCTURE_PACK.boards.length);
  });
});

describe("빈 상태 — 남의 회사 이름이 따라오지 않는다 (D71~D75)", () => {
  /** 목업·먼데이 실측에 등장하는 예시 사람 이름. 제품 시드에 있으면 안 된다. */
  const EXAMPLE_PEOPLE = ["카뮈", "이대표", "박정화", "김수현", "이서준", "조은혜"];
  /** 실측에 등장하는 예시 업체명. */
  const EXAMPLE_COMPANIES = ["대한정밀", "미래로지스", "우진산업"];

  it("그룹 이름에 예시 사람·업체 이름이 없다", () => {
    const ctx = createWorkspace();
    const repo = getBoardsRepo();
    const names = repo.listBoards(ctx).flatMap((board) =>
      repo.listGroups(ctx, board.id).map((group) => group.name),
    );

    for (const banned of [...EXAMPLE_PEOPLE, ...EXAMPLE_COMPANIES]) {
      expect(names.join(" "), banned).not.toContain(banned);
    }
  });

  it("컬럼 선택지에도 예시 사람 이름이 없다", () => {
    const ctx = createWorkspace();
    const repo = getBoardsRepo();
    const labels = repo.listBoards(ctx).flatMap((board) =>
      repo
        .listColumns(ctx, board.id)
        .flatMap((column) => (column.options_jsonb?.options ?? []).map((option) => option.label)),
    );

    for (const banned of EXAMPLE_PEOPLE) expect(labels.join(" "), banned).not.toContain(banned);
  });

  it("★ 멤버가 1명이면 담당자별 그룹도 1개다 — 그게 «빈 상태» 다 (D73 · BBE-130)", () => {
    const ctx = createWorkspace();
    const repo = getBoardsRepo();

    // 팩의 담당자 슬롯은 보드당 2개(신규업체 2 · 컨텍관리 2). 멤버가 1명이므로
    // 슬롯 0 만 채워지고 슬롯 1 은 «만들지 않는다» — 없는 사람의 그룹을 만들지 않는다.
    const slotCount = allSectionPresets().filter((s) => s.assigneeSlot !== undefined).length;
    const filledSlots = SEOUL_STRUCTURE_PACK.boards.filter((board) =>
      board.sections.some((section) => section.assigneeSlot === 0),
    ).length;

    const created = repo.listBoards(ctx).reduce(
      (total, board) => total + repo.listGroups(ctx, board.id).length,
      0,
    );
    expect(created).toBe(allSectionPresets().length - (slotCount - filledSlots));
  });

  it("담당자별 그룹은 만든 사람의 표시 이름을 쓴다 — 제품에 박힌 이름이 아니다", () => {
    const ctx = createWorkspace();
    const repo = getBoardsRepo();
    const names = repo.listBoards(ctx).flatMap((board) =>
      repo.listGroups(ctx, board.id).map((group) => group.name),
    );

    // ♻️ 접두사 그룹은 «♻️ + 멤버 표시명» 으로 만들어진다.
    const assigneeGroups = names.filter((name) => name.startsWith("♻️"));
    expect(assigneeGroups.length).toBeGreaterThan(0);
    for (const name of assigneeGroups) expect(name).toContain(CREATOR.name);
  });
});

describe("구조 축소 0 (D73)", () => {
  it("팩이 선언한 컬럼을 하나도 빠뜨리지 않는다", () => {
    const ctx = createWorkspace();
    const repo = getBoardsRepo();
    const boards = repo.listBoards(ctx);

    const declared = SEOUL_STRUCTURE_PACK.boards.reduce((n, b) => n + b.columns.length, 0);
    const created = boards.reduce((n, b) => n + repo.listColumns(ctx, b.id).length, 0);

    expect(created).toBe(declared);
    expect(created).toBe(69); // 24 + 21 + 24 — 실측 고정
  });

  it("유예 컬럼(PLAN-003)은 만들지 않고 목록으로 돌려준다 — 없는 것을 있는 척하지 않는다", () => {
    resetDb();
    const repo = getRepo();
    repo.upsertUser(CREATOR);
    const { org } = repo.createOrg({ name: "유예 확인" }, CREATOR);
    const ctx = { user: CREATOR, org, role: "owner", scope: "all" } as unknown as Ctx;

    const result = bootstrapNewWorkspace(ctx);

    expect(result.structure.deferred.length).toBeGreaterThan(0);

    // ⚠ 컬럼 key 는 **보드 안에서만** 유일하다. 보드를 가로질러 비교하면 안 된다 —
    //   `__1` 은 신규고객의 설치 컬럼이면서 동시에 업무관리의 유예 컬럼이다(실측).
    const repo2 = getBoardsRepo();
    const boards = repo2.listBoards(ctx);
    for (const [index, packBoard] of SEOUL_STRUCTURE_PACK.boards.entries()) {
      const createdKeys = repo2.listColumns(ctx, boards[index].id).map((column) => column.key);
      for (const column of packBoard.deferredColumns) {
        expect(createdKeys, `${packBoard.slug}.${column.key}`).not.toContain(column.key);
      }
    }
  });
});
