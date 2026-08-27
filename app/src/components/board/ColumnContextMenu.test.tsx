// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn } from "@/lib/boards/types";
import { ColumnContextMenu } from "./ColumnContextMenu";

const command = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/boards/column-command-actions", () => ({ runColumnCommandAction: command }));

const source = readFileSync(resolve(process.cwd(), "src/components/board/ColumnContextMenu.tsx"), "utf8");
const workspace = readFileSync(resolve(process.cwd(), "src/components/board/BoardWorkspace.tsx"), "utf8");
const column = {
  id: "column-a", org_id: "org-a", board_id: "board-a", key: "amount", label: "지원 금액",
  type: "money", source: "in", sort_order: 1, width: 160, move_rule_jsonb: null,
} as BoardColumn;

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderMenu(two = false, onParentDrag = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<div data-overflow-host onDragStart={onParentDrag}>
      <ColumnContextMenu boardId="board-a" column={column}><span>지원 금액</span></ColumnContextMenu>
      {two ? <ColumnContextMenu boardId="board-a" column={{ ...column, id: "column-b", key: "date", label: "신청일" }}><span>신청일</span></ColumnContextMenu> : null}
    </div>);
  });
  return { host, onParentDrag };
}

async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

beforeEach(() => {
  command.mockReset();
  command.mockResolvedValue({ ok: true, message: "저장했습니다." });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Issue #604 ColumnContextMenu portal contract", () => {
  it("keeps discovery order, removes duplicate rename UI, and preserves server capability outside the consumer", () => {
    const labels = ["컬럼 복제", "오른쪽에 컬럼 추가", "컬럼 유형 변경", "컬럼 확장", "컬럼 설정", "삭제"];
    const positions = labels.map((label) => source.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(source).not.toContain("이름 바꾸기");
    expect(source).not.toContain('surface === "rename"');
  });

  it("moves menu to body and transitions menu -> one expanded panel without overlap", async () => {
    await renderMenu();
    await click(document.querySelector('[aria-label="지원 금액 컬럼 메뉴"]')!);
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.parentElement).toBe(document.body);
    expect(menu.closest("[data-overflow-host]")).toBeNull();
    await click([...menu.querySelectorAll("button")].find((button) => button.textContent === "컬럼 확장")!);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const panel = document.querySelector<HTMLElement>("[data-column-expanded-panel]")!;
    expect(panel).toBeTruthy();
    expect(panel.parentElement).toBe(document.body);
    expect(document.querySelectorAll("[data-column-expanded-panel]")).toHaveLength(1);
  });

  it("keeps a single board surface when another column opens", async () => {
    await renderMenu(true);
    const triggers = document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]');
    await click(triggers[0]);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    await click(triggers[1]);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toContain("신청일");
  });

  it("isolates the trigger from a draggable ancestor", async () => {
    const onParentDrag = vi.fn();
    await renderMenu(false, onParentDrag);
    const trigger = document.querySelector<HTMLElement>('[aria-haspopup="menu"]')!;
    await act(async () => trigger.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true })));
    expect(onParentDrag).not.toHaveBeenCalled();
    expect(trigger.getAttribute("draggable")).toBe("false");
    expect(trigger.className).not.toMatch(/\bpy-/u);
  });

  it("uses product confirmation for archive instead of window.confirm", async () => {
    await renderMenu();
    await click(document.querySelector('[aria-haspopup="menu"]')!);
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "삭제")!);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("값과 설정은 보존");
    expect(source).not.toContain("window.confirm");
  });

  it("keeps the command dialog and announces a server failure", async () => {
    command.mockResolvedValueOnce({ ok: false, message: "권한이 없어요." });
    await renderMenu();
    await click(document.querySelector('[aria-haspopup="menu"]')!);
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "컬럼 복제")!);
    const apply = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "적용")!;
    await click(apply);
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("권한이 없어요");
  });

  it("disables duplicate submission while a command is pending", async () => {
    let finish: ((value: { ok: boolean; message: string }) => void) | undefined;
    command.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await renderMenu();
    await click(document.querySelector('[aria-haspopup="menu"]')!);
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "컬럼 복제")!);
    const apply = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "적용")!;
    act(() => { apply.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => Promise.resolve());
    const pending = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "저장 중…")!;
    expect(pending.disabled).toBe(true);
    act(() => { pending.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(command).toHaveBeenCalledTimes(1);
    await act(async () => { finish?.({ ok: true, message: "저장했습니다." }); });
  });

  it("keeps archive undo in the persistent board shell", () => {
    expect(source).toContain("onArchived?.(result.archivedColumnId)");
    expect(workspace).toContain("archivedColumnIds");
    expect(workspace).toContain("컬럼을 휴지통으로 옮겼습니다. 값과 설정은 보존됩니다.");
  });
});
