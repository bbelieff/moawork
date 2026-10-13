import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue 857 — BoardWorkspace 가 셀 저장 뒤 조용히 새로 받으려 useRouter 를 쓴다. 이 시험은 라우터 없이
// 서버 렌더만 하므로 그 하나만 대신한다(나머지 next/navigation 은 실제 그대로).
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} }),
}));
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Board, BoardColumn } from "@/lib/boards/types";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { TabSettingsDialog } from "@/components/board/TabSettingsDialog";
import { resolveColumnOrder } from "@/components/board/layout";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
import { CONTACT_GROUPS, CONTACT_TAB } from "./contact";
import type { DefaultTab } from "./types";
import { ensureDefaultTabAdditive } from "./install";
import { BoardsService } from "@/lib/boards/service";

const ctx = { org: { id: "org-parity", name: "QA" }, user: { id: "user", name: "QA", email: "qa@example.test" }, role: "owner", scope: "all" } as Ctx;

describe("actual board rendering and definition reconciliation", () => {
  beforeEach(() => resetDb());

  // #845 (2026-10-08): the single settings entry is the header's top-right 「탭 설정」 button; it opens a dialog.
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
      assigneeLabels: {}, tabSettingsSlot: createElement(TabSettingsDialog, { general: createElement("p", null, "열린 설정") }),
      tabSettingsSections: ["general", "fields", "stages"],
    }));
    expect(html.indexOf("data-board-tab-settings")).toBeGreaterThan(-1);
    expect(html.indexOf("탭 설정")).toBeLessThan(html.indexOf("그룹이 없습니다"));
    expect((html.match(/탭 설정/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain("보드 설정");
    // The dialog stays closed until the entry is pressed.
    expect(html).not.toContain("열린 설정");
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
    expect((await reloaded.getDefaultDefinitionState?.(ctx, board.id))?.revision).toBe(CONTACT_TAB.revision);
  });

  // QA #884 (belie 2026-10-13) — revision 3 boards had no contract_status move rule. Revision 4 turns it on only
  // where the stored rule is still empty; a rule the company already set is theirs and stays untouched.
  const contactRevision3: DefaultTab = {
    ...CONTACT_TAB,
    revision: 3,
    previousRevision: undefined,
    columns: CONTACT_TAB.columns.map((column) => (column.key === "contract_status" ? { ...column, moveTo: undefined } : column)),
  };

  it("fills the empty contract_status move rule from the revision 4 definition", async () => {
    const repo = toAsyncBoardsRepo(new LocalBoardsRepo());
    const { boardId } = await ensureDefaultTabAdditive(ctx, contactRevision3, repo, []);
    const before = (await repo.listColumns(ctx, boardId)).find((column) => column.key === "contract_status")!;
    expect(before.move_rule_jsonb ?? null).toBeNull();
    await ensureDefaultTabAdditive(ctx, CONTACT_TAB, repo, []);
    const groups = await repo.listGroups(ctx, boardId);
    const groupId = (name: string) => groups.find((group) => group.name === name)!.id;
    const after = (await new LocalBoardsRepo().listColumns(ctx, boardId)).find((column) => column.key === "contract_status")!;
    expect(after.move_rule_jsonb).toEqual({
      "계약 보류": groupId(CONTACT_GROUPS.contractHold),
      "미팅보류": groupId(CONTACT_GROUPS.meetingHold),
      "미팅취소": groupId(CONTACT_GROUPS.meetingCancelled),
      "계약취소": groupId(CONTACT_GROUPS.contractCancelled),
    });
    expect((await repo.getDefaultDefinitionState?.(ctx, boardId))?.revision).toBe(4);
  });

  it("leaves a company-customized contract_status move rule alone", async () => {
    const repo = toAsyncBoardsRepo(new LocalBoardsRepo());
    const { boardId } = await ensureDefaultTabAdditive(ctx, contactRevision3, repo, []);
    const groups = await repo.listGroups(ctx, boardId);
    const custom = { "계약취소": groups.find((group) => group.name === CONTACT_GROUPS.meetingHold)!.id };
    const column = (await repo.listColumns(ctx, boardId)).find((candidate) => candidate.key === "contract_status")!;
    await repo.updateColumn(ctx, column.id, { moveRule: custom });
    await ensureDefaultTabAdditive(ctx, CONTACT_TAB, repo, []);
    const after = (await repo.listColumns(ctx, boardId)).find((candidate) => candidate.key === "contract_status")!;
    const groupId = (name: string) => groups.find((group) => group.name === name)!.id;
    // The company's own destination wins (계약취소 → 미팅보류, not the definition's 계약취소 group). The regular
    // move-rule backfill (planMoveRuleBackfill) still adds only the entries that were missing — existing behaviour.
    expect(after.move_rule_jsonb).toEqual({
      ...custom,
      "계약 보류": groupId(CONTACT_GROUPS.contractHold),
      "미팅보류": groupId(CONTACT_GROUPS.meetingHold),
      "미팅취소": groupId(CONTACT_GROUPS.meetingCancelled),
    });
    expect(after.move_rule_jsonb?.["계약취소"]).not.toBe(groupId(CONTACT_GROUPS.contractCancelled));
    expect((await repo.getDefaultDefinitionState?.(ctx, boardId))?.revision).toBe(4);
  });

  it("edits a linked provenance cell and reloads the persisted value through a fresh service", async () => {
    const repo = toAsyncBoardsRepo(new LocalBoardsRepo());
    const board = await repo.createBoard(ctx, { name: CONTACT_TAB.name, source: CONTACT_TAB.source });
    await ensureDefaultTabAdditive(ctx, CONTACT_TAB, repo, []);
    const service = new BoardsService(repo);
    const item = await service.createItem(ctx, board.id, { title: "로컬 검증" });
    const saved = await service.setCells(ctx, board.id, item.id, { rep_name: "수정 가능한 연결값" });
    expect(saved.errors).toEqual([]);
    const reloaded = await new BoardsService(toAsyncBoardsRepo(new LocalBoardsRepo())).getItem(ctx, board.id, item.id);
    expect(reloaded.values.rep_name).toBe("수정 가능한 연결값");
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
