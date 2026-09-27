// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

const actions = vi.hoisted(() => ({
  addBoardLabelOptionAction: vi.fn(), setCellAction: vi.fn(),
  moveRowAction: vi.fn(), reorderGroupsAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/actions", () => actions);
vi.mock("@/app/(app)/boards/label-option-actions", () => ({ addBoardLabelOptionAction: actions.addBoardLabelOptionAction }));
import { SavedViewsController } from "./SavedViewsController";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
beforeEach(() => {
  window.history.replaceState({}, "", "/boards/board-1?view=flat");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })));
  actions.addBoardLabelOptionAction.mockResolvedValue({ ok: true, message: "추가했어요", optionId: "새 선택지" });
  actions.setCellAction.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
async function mount(key: string, { canManageColumns = true, canEditItems = true, isSystem = false } = {}) {
  const column: BoardColumn = {
    id: `column-${key}`, org_id: "org-1", board_id: "board-1", key, label: "선택지", type: "select",
    source: "act", rightPinned: false, options_jsonb: { options: [{ id: "old", label: "기존 선택지", order: 0 }] },
    sort_order: 0, width: null, is_readonly: false, move_rule_jsonb: null,
  };
  const row: ItemWithValues = {
    id: "item-1", org_id: "org-1", board_id: "board-1", group_id: "group-1", title: "합성 항목",
    assigned_to: null, deal_id: null, sort_order: 0, created_at: "", updated_at: "", values: { [key]: "old" },
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<SavedViewsController boardId="board-1" orgId="org-1" currentUserId="user-1"
    renderMode="flat" rows={[row]} columns={[column]} canEditItems={canEditItems}
    canManageColumns={canManageColumns} isSystem={isSystem} />));
  return host;
}
async function search(host: HTMLElement, value: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="선택지"]')!;
  expect(input).not.toBeNull();
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("#797 saved flat label creation", () => {
  it.each(["institution", "fund_name", "product"])("permitted %s uses existing create and cell-save actions", async (key) => {
    const host = await mount(key);
    await search(host, "새 선택지");
    const create = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("새로 만들기"));
    expect(create).toBeDefined();
    await act(async () => create!.click());
    expect(actions.addBoardLabelOptionAction).toHaveBeenCalledTimes(1);
    expect(actions.addBoardLabelOptionAction).toHaveBeenCalledWith({
      boardId: "board-1", columnId: `column-${key}`, label: "새 선택지", requestId: expect.any(String),
    });
    expect(actions.setCellAction).toHaveBeenCalledTimes(1);
    const form = actions.setCellAction.mock.calls[0][0] as FormData;
    expect(form.get("value")).toBe("새 선택지");
    expect(form.get("columnKey")).toBe(key);
  });
  it.each([{ canManageColumns: false }, { isSystem: true }])("keeps creation hidden for restricted props %j", async (permissions) => {
    const host = await mount("institution", permissions);
    await search(host, "기존");
    expect(host.textContent).toContain("기존 선택지");
    await search(host, "새 선택지");
    expect(host.textContent).not.toContain("새로 만들기");
    expect(actions.addBoardLabelOptionAction).not.toHaveBeenCalled();
  });
  it("keeps read-only cells noninteractive even with column permission", async () => {
    const host = await mount("institution", { canEditItems: false });
    expect(host.textContent).toContain("기존 선택지");
    expect(host.querySelector('input[aria-label="선택지"]')).toBeNull();
    expect(actions.addBoardLabelOptionAction).not.toHaveBeenCalled();
  });
});
