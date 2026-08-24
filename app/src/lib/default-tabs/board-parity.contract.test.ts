import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Board, BoardColumn } from "@/lib/boards/types";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { resolveColumnOrder } from "@/components/board/layout";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
import { CONTACT_TAB } from "./contact";
import { ensureDefaultTabAdditive } from "./install";

const ctx = { org: { id: "org-parity", name: "QA" }, user: { id: "user", name: "QA", email: "qa@example.test" }, role: "owner", scope: "all" } as Ctx;

describe("actual board rendering and definition reconciliation", () => {
  beforeEach(() => resetDb());

  it("renders the one settings entry above board groups and keeps the workflow gate last", () => {
    const columns = CONTACT_TAB.columns.map((definition, sort_order) => ({
      id: definition.key, org_id: ctx.org.id, board_id: "board", key: definition.key,
      label: definition.label, type: definition.type, source: definition.source,
      rightPinned: Boolean(definition.rightPinned), options_jsonb: null, sort_order,
      width: definition.width ?? null, is_readonly: Boolean(definition.readOnly),
    })) as BoardColumn[];
    expect(resolveColumnOrder(columns, ["work_move", "owner"]).at(-1)?.key).toBe("work_move");
    const board = { id: "board", org_id: ctx.org.id, name: "리드컨택 관리", description: null, icon: null, is_system: false, source: CONTACT_TAB.source, sort_order: 0, created_by: "user", created_at: "", updated_at: "" } as Board;
    const html = renderToStaticMarkup(createElement(BoardWorkspace, {
      board, columns, groups: [], rows: [], columnOrder: {}, cellFlash: null,
      assigneeLabels: {}, settingsSlot: createElement("button", null, "보드 설정"),
    }));
    expect(html.indexOf("보드 설정")).toBeGreaterThan(-1);
    expect(html.indexOf("보드 설정")).toBeLessThan(html.indexOf("그룹이 없습니다"));
    expect((html.match(/보드 설정/g) ?? [])).toHaveLength(1);
  });

  it("reconciles only the untouched legacy readOnly property and survives a new repo instance", async () => {
    const repo = toAsyncBoardsRepo(new LocalBoardsRepo());
    const board = await repo.createBoard(ctx, { name: CONTACT_TAB.name, source: CONTACT_TAB.source });
    for (const [sortOrder, definition] of CONTACT_TAB.columns.entries()) {
      await repo.createColumn(ctx, board.id, { ...definition, readOnly: definition.source === "lk" ? true : definition.readOnly, sortOrder });
    }
    await ensureDefaultTabAdditive(ctx, CONTACT_TAB, repo, []);
    const reloaded = toAsyncBoardsRepo(new LocalBoardsRepo());
    expect((await reloaded.listColumns(ctx, board.id)).filter((column) => column.source === "lk").every((column) => !column.is_readonly)).toBe(true);
    expect((await reloaded.getDefaultDefinitionState?.(ctx, board.id))?.revision).toBe(2);
  });

  it("preserves a customized property that differs from the stored baseline", async () => {
    const repo = toAsyncBoardsRepo(new LocalBoardsRepo());
    const board = await repo.createBoard(ctx, { name: CONTACT_TAB.name, source: CONTACT_TAB.source });
    const custom = await repo.createColumn(ctx, board.id, { key: "ad_name", label: "내 광고", type: "text", source: "lk", readOnly: false });
    await repo.setDefaultDefinitionState?.(ctx, board.id, { revision: 1, columns: { ad_name: { label: "광고 명", readOnly: true, rightPinned: false, sortOrder: 0 } } });
    await ensureDefaultTabAdditive(ctx, CONTACT_TAB, repo, []);
    expect((await repo.listColumns(ctx, board.id)).find((column) => column.id === custom.id)?.label).toBe("내 광고");
  });
});
