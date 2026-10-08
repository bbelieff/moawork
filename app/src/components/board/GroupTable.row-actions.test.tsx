// @vitest-environment jsdom
/**
 * #845 개선안(2026-10-08, 승인 목업 Rows) — 업체명 칸을 «그려진 결과와 행동» 으로 잰다.
 *   · 이름을 누르면 상세가 열린다(「열기 ↗」 단추 없음). 「옆에 열기」 아이콘도 같은 상세를 연다.
 *   · 행 우클릭 · Shift+F10 메뉴: 옆에 열기 · 업체명 바꾸기 | 휴지통으로 이동(권한이 있을 때만).
 *   · 휴지통으로 이동 → 기존 trashItemAction, 보드 아래 「되돌리기」 → 기존 restoreItemAction.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trash = vi.hoisted(() => ({
  trashItemAction: vi.fn(),
  restoreItemAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/trash-actions", () => trash);

import { GroupTable } from "./GroupTable";
import { ItemTrashUndoToast } from "./ItemTrashUndo";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  trash.trashItemAction.mockReset().mockResolvedValue({ ok: true, message: "항목을 휴지통으로 옮겼습니다." });
  trash.restoreItemAction.mockReset().mockResolvedValue({ ok: true, message: "항목을 원래 위치로 복구했습니다." });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", window.location.pathname);
});

const textColumn: BoardColumn = {
  id: "col-memo", org_id: "org", board_id: "b1", key: "memo", label: "메모", type: "text", source: "in",
  rightPinned: false, options_jsonb: null, sort_order: 0, width: null,
};

function row(id: string, title: string): ItemWithValues {
  return {
    id, org_id: "org", board_id: "b1", group_id: "g1", title, assigned_to: null, deal_id: null, sort_order: 0,
    created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z", values: { memo: "메모 값" },
  };
}

async function mount({
  canDeleteItems = true,
  readOnly = false,
  work = true,
}: { canDeleteItems?: boolean; readOnly?: boolean; work?: boolean } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <>
      <GroupTable
        boardId="b1"
        groupId="g1"
        groupName="준비단계"
        columns={[textColumn]}
        rows={[row("row-a", "다온디자인"), row("row-b", "리드건설")]}
        readOnly={readOnly}
        canDeleteItems={canDeleteItems}
        workflowProgressKind={work ? "work" : null}
        itemDetailFixture={{ ok: true, events: [], links: [], files: [], members: [] }}
        rowDragEnabled
        cellFlash={null}
        onColumnDrop={() => {}}
        dragRowId={null}
        canDropRow={() => false}
        onRowDragStart={() => {}}
        onRowDragEnd={() => {}}
        onRowDrop={() => {}}
        hideAddRow
      />
      <ItemTrashUndoToast boardId="b1" />
    </>,
  ));
  return host;
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][data-item-detail-backdrop]');
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const menuLabels = () => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].map((node) => node.textContent);
const nameButton = (host: HTMLElement, title: string) =>
  host.querySelector<HTMLButtonElement>(`button[data-row-name][aria-label="${title} 상세 열기"]`)!;

async function rightClick(target: Element, x = 120, y = 80) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

async function clickMenuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === label);
  expect(item).toBeDefined();
  await act(async () => { item!.click(); });
}

describe("업체명 칸 — 이름이 곧 «열기»", () => {
  it("칸에는 체크·이름·옆에 열기만 있고, 이름을 누르면 그 행의 상세가 열린다", async () => {
    const host = await mount();
    const cell = host.querySelector<HTMLElement>("tbody tr[data-board-row] td[data-board-title-cell]")!;
    expect(cell.textContent).not.toContain("열기 ↗");
    expect(cell.textContent).not.toContain("삭제");
    expect(cell.querySelector("input:not([type=checkbox])")).toBeNull();
    expect(cell.querySelector('[aria-label="다온디자인 옆에 열기"]')).not.toBeNull();

    const name = nameButton(host, "다온디자인");
    expect(name.textContent).toBe("다온디자인");
    expect(name.getAttribute("title")).toBe("다온디자인");
    expect(name.getAttribute("data-item-detail-trigger")).toBe("row-a");
    await act(async () => { name.click(); });
    expect(dialog()?.getAttribute("aria-label")).toBe("다온디자인 상세");
    expect(window.location.hash).toBe("#item-row-a");
  });

  it("「옆에 열기」 아이콘도 같은 상세를 연다", async () => {
    const host = await mount();
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="리드건설 옆에 열기"]')!.click(); });
    expect(dialog()?.getAttribute("aria-label")).toBe("리드건설 상세");
  });
});

describe("행 우클릭 메뉴", () => {
  it("행을 우클릭하면 옆에 열기 · 업체명 바꾸기 · 휴지통으로 이동(마지막·위험색)이 뜬다", async () => {
    const host = await mount();
    const event = await rightClick(host.querySelectorAll("tbody tr[data-board-row]")[0].querySelector("td:last-child")!);
    expect(event.defaultPrevented).toBe(true);
    expect(menu()?.getAttribute("aria-label")).toBe("다온디자인 행 메뉴");
    expect(menuLabels()).toEqual(["옆에 열기", "업체명 바꾸기", "휴지통으로 이동"]);
    const last = [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].at(-1)!;
    expect(last.style.color).toBe("var(--mw-error)");
  });

  it("지울 권한이 없으면 「휴지통으로 이동」 이, 읽기 전용이면 「바꾸기」 도 없다", async () => {
    const host = await mount({ canDeleteItems: false });
    await rightClick(host.querySelector("tbody tr[data-board-row]")!);
    expect(menuLabels()).toEqual(["옆에 열기", "업체명 바꾸기"]);
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();

    const readOnlyHost = await mount({ canDeleteItems: false, readOnly: true });
    await rightClick(readOnlyHost.querySelector("tbody tr[data-board-row]")!);
    expect(menuLabels()).toEqual(["옆에 열기"]);
  });

  it("다른 보드는 「이름 바꾸기」 로 부른다", async () => {
    const host = await mount({ work: false });
    await rightClick(host.querySelector("tbody tr[data-board-row]")!);
    expect(menuLabels()).toEqual(["옆에 열기", "이름 바꾸기", "휴지통으로 이동"]);
  });

  it("키보드 Shift+F10 · 메뉴 키로도 연다", async () => {
    const host = await mount();
    const name = nameButton(host, "리드건설");
    name.focus();
    await act(async () => { name.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(menu()?.getAttribute("aria-label")).toBe("리드건설 행 메뉴");
    await act(async () => { menu()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(menu()).toBeNull();
    await act(async () => { name.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true })); });
    expect(menu()?.getAttribute("aria-label")).toBe("리드건설 행 메뉴");
  });

  it("글자를 고치는 칸에서는 브라우저 기본 메뉴를 그대로 둔다", async () => {
    const host = await mount();
    const input = host.querySelector<HTMLInputElement>('tbody tr[data-board-row] input[aria-label="메모"]')!;
    expect(input).not.toBeNull();
    const event = await rightClick(input);
    expect(event.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it("「옆에 열기」 는 상세를 열고, 「업체명 바꾸기」 는 상세 제목을 고치는 칸으로 연다", async () => {
    const host = await mount();
    await rightClick(host.querySelector("tbody tr[data-board-row]")!);
    await clickMenuItem("옆에 열기");
    expect(menu()).toBeNull();
    expect(dialog()?.getAttribute("aria-label")).toBe("다온디자인 상세");
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    await rightClick(host.querySelectorAll("tbody tr[data-board-row]")[1]);
    await clickMenuItem("업체명 바꾸기");
    expect(dialog()?.getAttribute("aria-label")).toBe("리드건설 상세");
    const titleInput = dialog()!.querySelector<HTMLInputElement>("input[data-item-detail-title-input]");
    expect(titleInput?.getAttribute("aria-label")).toBe("업체명");
    expect(titleInput?.value).toBe("리드건설");
    expect(document.activeElement).toBe(titleInput);
  });

  it("「휴지통으로 이동」 은 기존 휴지통 액션을 부르고, 되돌리기 알림의 되돌리기가 기존 복구 액션을 부른다", async () => {
    const host = await mount();
    await rightClick(host.querySelector("tbody tr[data-board-row]")!);
    await clickMenuItem("휴지통으로 이동");
    expect(trash.trashItemAction).toHaveBeenCalledTimes(1);
    const sent = trash.trashItemAction.mock.calls[0][1] as FormData;
    expect([sent.get("boardId"), sent.get("itemId")]).toEqual(["b1", "row-a"]);

    const toast = document.querySelector<HTMLElement>('[data-item-trash-toast="trashed"]');
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.textContent).toContain("「다온디자인」을 휴지통으로 옮겼어요");
    const undo = [...toast!.querySelectorAll("button")].find((button) => button.textContent === "되돌리기")!;
    await act(async () => { undo.click(); });
    expect(trash.restoreItemAction).toHaveBeenCalledTimes(1);
    const restored = trash.restoreItemAction.mock.calls[0][1] as FormData;
    expect([restored.get("boardId"), restored.get("itemId")]).toEqual(["b1", "row-a"]);
    expect(document.querySelector("[data-item-trash-toast]")).toBeNull();
  });

  it("옮기지 못하면 사유를 알림(alert)으로 말하고 되돌리기는 없다", async () => {
    trash.trashItemAction.mockResolvedValueOnce({ ok: false, message: "이 항목을 삭제하거나 복구할 권한이 없습니다." });
    const host = await mount();
    await rightClick(host.querySelector("tbody tr[data-board-row]")!);
    await clickMenuItem("휴지통으로 이동");
    const toast = document.querySelector<HTMLElement>('[data-item-trash-toast="error"]');
    expect(toast?.getAttribute("role")).toBe("alert");
    expect(toast?.textContent).toContain("이 항목을 삭제하거나 복구할 권한이 없습니다.");
    expect([...toast!.querySelectorAll("button")].some((button) => button.textContent === "되돌리기")).toBe(false);
  });
});
