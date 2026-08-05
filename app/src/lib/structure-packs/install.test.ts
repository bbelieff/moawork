import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { BoardsService } from "@/lib/boards";
import type { Ctx } from "@/lib/types";
import { SEOUL_STRUCTURE_PACK } from "./seoul-pack";
import { installStructurePack } from "./install";

function owner(): Ctx {
  return {
    user: { id: SEED_USER_OWNER, email: "t@demo", name: "t", avatar_url: null, created_at: "" },
    org: { id: SEED_ORG_ID, name: "demo", plan_tier: "t1_3", created_at: "" },
    role: "owner",
    scope: "all",
  } as Ctx;
}

const boards = () => new BoardsService();

beforeEach(() => {
  resetDb();
});

describe("새 조직 설치 — acceptance (PLAN-002/WO-1)", () => {
  it("3개 보드가 팩 순서대로 생성된다", () => {
    const result = installStructurePack(owner());
    expect(result.boards.map((b) => b.slug)).toEqual(["newcust", "contact", "work"]);

    const installed = boards().listBoards(owner());
    for (const packBoard of SEOUL_STRUCTURE_PACK.boards) {
      const found = installed.find((b) => b.name === packBoard.name);
      expect(found, `${packBoard.name} 생성됨`).toBeDefined();
      expect(found?.icon).toBe(packBoard.icon);
    }
  });

  it("그룹이 이름·색·순서까지 팩 그대로 생성된다", () => {
    const result = installStructurePack(owner());

    for (const [index, packBoard] of SEOUL_STRUCTURE_PACK.boards.entries()) {
      const detail = boards().getBoardDetail(owner(), result.boards[index].boardId);
      const ordered = [...detail.groups].sort((a, b) => a.sort_order - b.sort_order);

      expect(ordered.map((g) => g.name), `${packBoard.slug} 그룹 이름·순서`).toEqual(
        packBoard.sections.map((s) => s.groupName),
      );
      expect(ordered.map((g) => g.color), `${packBoard.slug} 그룹 색`).toEqual(
        packBoard.sections.map((s) => s.color),
      );
    }
  });

  it("컬럼이 key·라벨·타입·순서까지 팩 그대로 생성된다", () => {
    const result = installStructurePack(owner());

    for (const [index, packBoard] of SEOUL_STRUCTURE_PACK.boards.entries()) {
      const detail = boards().getBoardDetail(owner(), result.boards[index].boardId);
      const ordered = [...detail.columns].sort((a, b) => a.sort_order - b.sort_order);

      expect(ordered.map((c) => c.key), `${packBoard.slug} 컬럼 순서`).toEqual(
        packBoard.columns.map((c) => c.key),
      );
      expect(ordered.map((c) => c.label)).toEqual(packBoard.columns.map((c) => c.label));
      expect(ordered.map((c) => c.type)).toEqual(packBoard.columns.map((c) => c.type));
    }
  });

  it("상태 라벨의 hex 색이 선택지에 그대로 실린다", () => {
    const result = installStructurePack(owner());
    const detail = boards().getBoardDetail(owner(), result.boards[0].boardId);

    const 상담상황 = detail.columns.find((c) => c.key === "status");
    const options = 상담상황?.options_jsonb?.options;
    expect(options).toHaveLength(16);
    expect(options?.[0]).toMatchObject({
      id: "2차 상담예약",
      label: "2차 상담예약",
      color: "#9d50dd",
    });
    expect(options?.at(-1)).toMatchObject({ label: "상담 전", color: "#c4c4c4" });
  });

  it("저장 뷰가 생성된다 — 업무관리 테이블 뷰 7종", () => {
    const result = installStructurePack(owner());
    const workBoardId = result.boards[2].boardId;

    const views = boards().listViews(owner(), workBoardId);
    expect(views.map((v) => v.name)).toEqual(
      SEOUL_STRUCTURE_PACK.boards[2].views.map((v) => v.name),
    );
    expect(views).toHaveLength(7);
  });

  it("아이템(행) 데이터는 만들지 않는다 — 구조만 복제한다", () => {
    const result = installStructurePack(owner());
    for (const board of result.boards) {
      expect(boards().listItems(owner(), board.boardId)).toHaveLength(0);
    }
  });
});

describe("유예 컬럼은 설치되지 않는다", () => {
  it("수식·타임라인·하위아이템은 보드에 만들어지지 않고 목록으로만 돌아온다", () => {
    const result = installStructurePack(owner());

    // 업무관리: 하위 태스크 + 타임라인 + 수식 4 = 6
    const workDeferred = result.deferred.filter((d) => d.boardSlug === "work");
    expect(workDeferred).toHaveLength(6);

    const detail = boards().getBoardDetail(owner(), result.boards[2].boardId);
    const installedKeys = new Set(detail.columns.map((c) => c.key));
    for (const column of workDeferred) {
      expect(installedKeys.has(column.key), `${column.label} 미설치`).toBe(false);
    }
  });

  it("팩 전체 유예 컬럼은 9종이다", () => {
    expect(installStructurePack(owner()).deferred).toHaveLength(9);
  });
});

describe("재설치 안전성", () => {
  it("두 번 설치해도 보드가 두 벌 생기지 않는다", () => {
    installStructurePack(owner());
    const before = boards().listBoards(owner()).length;

    const second = installStructurePack(owner());
    expect(second.boards).toHaveLength(0);
    expect(second.skipped).toEqual(["newcust", "contact", "work"]);
    expect(boards().listBoards(owner())).toHaveLength(before);
  });

  it("일부만 있는 상태에서는 나머지만 채운다", () => {
    const first = installStructurePack(owner(), {
      pack: { ...SEOUL_STRUCTURE_PACK, boards: [SEOUL_STRUCTURE_PACK.boards[0]] },
    });
    expect(first.boards).toHaveLength(1);

    const second = installStructurePack(owner());
    expect(second.skipped).toEqual(["newcust"]);
    expect(second.boards.map((b) => b.slug)).toEqual(["contact", "work"]);
  });
});
