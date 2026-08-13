/**
 * 보드 저장뷰(board_views · 003) 서비스 테스트 — T05 B3.
 * 기본 뷰 규약은 T05 `lib/custom/views.pickDefaultView` 재사용(2중 구현 금지) —
 * 여기서는 **보드 표면에서도 같은 규약이 성립하는지**를 검증한다.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BoardsService, NotFoundError } from "./service";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_OWNER, SEED_BOARD_TASKS } from "@/lib/repo/local/seed";
import { getRepo } from "@/lib/repo";
import type { Ctx } from "@/lib/types";

function ownerCtx(): Ctx {
  const repo = getRepo();
  const user = repo.getUser(SEED_USER_OWNER);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role: "owner", scope: "all" };
}

let svc: BoardsService;
let ctx: Ctx;

beforeEach(async () => {
  resetDb();
  svc = new BoardsService(toAsyncBoardsRepo(new LocalBoardsRepo()));
  ctx = ownerCtx();
});

describe("뷰 CRUD", () => {
  it("생성 후 목록에 나타난다", async () => {
    const view = await svc.createView(ctx, SEED_BOARD_TASKS, { name: "내 뷰", kind: "table" });
    expect(view.name).toBe("내 뷰");
    expect(view.board_id).toBe(SEED_BOARD_TASKS);
    expect((await svc.listViews(ctx, SEED_BOARD_TASKS)).map((v) => v.id)).toContain(view.id);
  });

  it("수정은 넘긴 필드만 바꾼다", async () => {
    const view = await svc.createView(ctx, SEED_BOARD_TASKS, {
      name: "원본",
      kind: "table",
      shared: false,
    });
    const updated = await svc.updateView(ctx, view.id, { name: "수정됨", shared: true });

    expect(updated.name).toBe("수정됨");
    expect(updated.shared).toBe(true);
    expect(updated.kind).toBe("table"); // 안 넘긴 필드는 보존
  });

  it("칸반 뷰의 필터·정렬·표시컬럼이 보존된다", async () => {
    const view = await svc.createView(ctx, SEED_BOARD_TASKS, {
      name: "칸반",
      kind: "kanban",
      filters: { status: "opt-todo" },
      sort: [{ key: "due", dir: "asc" }],
      visibleColumns: ["status", "due"],
    });
    const [found] = (await svc.listViews(ctx, SEED_BOARD_TASKS)).filter((v) => v.id === view.id);

    expect(found.kind).toBe("kanban");
    expect(found.filters_jsonb).toEqual({ status: "opt-todo" });
    expect(found.sort_jsonb).toEqual([{ key: "due", dir: "asc" }]);
    expect(found.visible_columns_jsonb).toEqual(["status", "due"]);
  });

  it("삭제 후 목록에서 사라진다", async () => {
    const view = await svc.createView(ctx, SEED_BOARD_TASKS, { name: "삭제될 뷰", kind: "table" });
    await svc.deleteView(ctx, view.id);
    expect((await svc.listViews(ctx, SEED_BOARD_TASKS)).map((v) => v.id)).not.toContain(view.id);
  });

  it("없는 뷰 수정·삭제는 404", async () => {
    await expect(async () => (await svc.updateView(ctx, "ghost", { name: "x" }))).rejects.toThrow(NotFoundError);
    await expect(async () => (await svc.deleteView(ctx, "ghost"))).rejects.toThrow(NotFoundError);
  });

  it("없는 보드의 뷰 목록은 404", async () => {
    await expect(async () => (await svc.listViews(ctx, "ghost-board"))).rejects.toThrow(NotFoundError);
  });

  it("다른 사용자는 공유 뷰도 수정하거나 삭제할 수 없다", async () => {
    const view = await svc.createView(ctx, SEED_BOARD_TASKS, {
      name: "owner view",
      kind: "table",
      shared: true,
    });
    const other = {
      ...ctx,
      user: { ...ctx.user, id: "same-org-other-user", email: "other@example.test" },
    };

    await expect(svc.updateView(other, view.id, { name: "stolen" })).rejects.toThrow(NotFoundError);
    await expect(svc.deleteView(other, view.id)).rejects.toThrow(NotFoundError);
    expect((await svc.listViews(ctx, SEED_BOARD_TASKS)).find((candidate) => candidate.id === view.id)?.name)
      .toBe("owner view");
  });
});

describe("기본 뷰 규약 — shared 우선 → name ASC → id ASC", () => {
  it("뷰가 없으면 null", async () => {
    expect((await svc.getDefaultView(ctx, SEED_BOARD_TASKS))).toBeNull();
  });

  it("공유 뷰가 개인 뷰보다 우선", async () => {
    await svc.createView(ctx, SEED_BOARD_TASKS, { name: "AAA 개인", kind: "table", shared: false });
    const shared = await svc.createView(ctx, SEED_BOARD_TASKS, {
      name: "ZZZ 공유",
      kind: "table",
      shared: true,
    });
    // 이름은 뒤지만 shared 가 이긴다.
    expect((await svc.getDefaultView(ctx, SEED_BOARD_TASKS))?.id).toBe(shared.id);
  });

  it("shared 가 같으면 name ASC", async () => {
    const a = await svc.createView(ctx, SEED_BOARD_TASKS, { name: "A", kind: "table", shared: true });
    await svc.createView(ctx, SEED_BOARD_TASKS, { name: "B", kind: "table", shared: true });
    expect((await svc.getDefaultView(ctx, SEED_BOARD_TASKS))?.id).toBe(a.id);
  });

  it("생성 순서와 무관하게 결정적", async () => {
    await svc.createView(ctx, SEED_BOARD_TASKS, { name: "B", kind: "table", shared: true });
    const a = await svc.createView(ctx, SEED_BOARD_TASKS, { name: "A", kind: "table", shared: true });
    // 나중에 만든 "A" 가 기본 — 생성순(created_at)이 아니라 name ASC 규약이므로.
    expect((await svc.getDefaultView(ctx, SEED_BOARD_TASKS))?.id).toBe(a.id);
  });
});
