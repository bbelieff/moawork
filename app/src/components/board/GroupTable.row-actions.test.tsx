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
  columns = [textColumn],
  rows = [row("row-a", "다온디자인"), row("row-b", "리드건설")],
}: { canDeleteItems?: boolean; readOnly?: boolean; work?: boolean; columns?: BoardColumn[]; rows?: ItemWithValues[] } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <>
      <GroupTable
        boardId="b1"
        groupId="g1"
        groupName="준비단계"
        columns={columns}
        rows={rows}
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

  it("링크(파일 칸 「내려받기」)는 브라우저 링크 메뉴를 그대로 두고, 업체명 단추는 행 메뉴를 연다", async () => {
    const fileColumn: BoardColumn = { ...textColumn, id: "col-file", key: "doc", label: "서류", type: "file" };
    const withFile = (id: string, title: string) => ({ ...row(id, title), values: { doc: "/api/files/sample" } });
    const host = await mount({ columns: [fileColumn], rows: [withFile("row-a", "다온디자인")] });
    const link = host.querySelector<HTMLAnchorElement>('tbody tr[data-board-row] a[href="/api/files/sample"]')!;
    expect(link.textContent?.trim()).toBe("내려받기");
    const event = await rightClick(link);
    expect(event.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();

    const onName = await rightClick(nameButton(host, "다온디자인"));
    expect(onName.defaultPrevented).toBe(true);
    expect(menu()?.getAttribute("aria-label")).toBe("다온디자인 행 메뉴");
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
    expect(document.querySelector('[data-item-trash-live="status"]')?.textContent).toBe("「다온디자인」을 휴지통으로 옮겼어요");
    expect(toast?.textContent).toContain("「다온디자인」을 휴지통으로 옮겼어요");
    const undo = [...toast!.querySelectorAll("button")].find((button) => button.textContent === "되돌리기")!;
    await act(async () => { undo.click(); });
    expect(trash.restoreItemAction).toHaveBeenCalledTimes(1);
    const restored = trash.restoreItemAction.mock.calls[0][1] as FormData;
    expect([restored.get("boardId"), restored.get("itemId")]).toEqual(["b1", "row-a"]);
    expect(document.querySelector("[data-item-trash-toast]")).toBeNull();
  });

  it("옮긴 뒤 초점은 다음 행 이름으로 — 마지막 행이면 앞 행 이름(<body> 로 떨어지지 않는다)", async () => {
    const host = await mount();
    await rightClick(host.querySelector("tbody tr[data-board-row]")!);
    await clickMenuItem("휴지통으로 이동");
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(nameButton(host, "리드건설"));

    await rightClick(host.querySelectorAll("tbody tr[data-board-row]")[1]);
    await clickMenuItem("휴지통으로 이동");
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(nameButton(host, "다온디자인"));
  });

  it("옮기지 못하면 초점은 그 행 이름에 남는다", async () => {
    trash.trashItemAction.mockResolvedValueOnce({ ok: false, message: "이 항목을 삭제하거나 복구할 권한이 없습니다." });
    const host = await mount();
    await rightClick(host.querySelector("tbody tr[data-board-row]")!);
    await clickMenuItem("휴지통으로 이동");
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(nameButton(host, "다온디자인"));
  });

  it("옮기지 못하면 사유를 알림(alert)으로 말하고 되돌리기는 없다", async () => {
    trash.trashItemAction.mockResolvedValueOnce({ ok: false, message: "이 항목을 삭제하거나 복구할 권한이 없습니다." });
    const host = await mount();
    await rightClick(host.querySelector("tbody tr[data-board-row]")!);
    await clickMenuItem("휴지통으로 이동");
    const toast = document.querySelector<HTMLElement>('[data-item-trash-toast="error"]');
    expect(document.querySelector('[data-item-trash-live="alert"]')?.textContent).toBe("이 항목을 삭제하거나 복구할 권한이 없습니다.");
    expect(toast?.textContent).toContain("이 항목을 삭제하거나 복구할 권한이 없습니다.");
    expect([...toast!.querySelectorAll("button")].some((button) => button.textContent === "되돌리기")).toBe(false);
  });
});

/*
 * #845 8단계(2026-10-08) — 터치 길게 누르기. iOS 는 contextmenu 를 보내지 않으므로
 * 터치 포인터가 약 0.5초 거의 움직이지 않으면 우클릭과 같은 행 메뉴를 연다.
 */
function pointer(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  target: Element,
  { x = 40, y = 30, pointerType = "touch", pointerId = 7 }: { x?: number; y?: number; pointerType?: string; pointerId?: number } = {},
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: pointerId },
    isPrimary: { value: true },
  });
  return act(async () => { target.dispatchEvent(event); });
}
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

describe("터치 길게 누르기 — 우클릭과 같은 행 메뉴", () => {
  it("0.5초 길게 누르면 같은 메뉴가 누른 자리에 열리고, 손을 뗄 때의 click 은 상세를 열지 않는다", async () => {
    const host = await mount();
    const name = nameButton(host, "다온디자인");
    await pointer("pointerdown", name, { x: 64, y: 48 });
    await wait(200);
    expect(menu()).toBeNull();
    await wait(350);
    expect(menu()?.getAttribute("aria-label")).toBe("다온디자인 행 메뉴");
    expect(menuLabels()).toEqual(["옆에 열기", "업체명 바꾸기", "휴지통으로 이동"]);
    const anchor = document.querySelector<HTMLElement>("[data-row-menu-anchor]")!;
    expect([anchor.style.left, anchor.style.top]).toEqual(["64px", "48px"]);

    await pointer("pointerup", name, { x: 64, y: 48 });
    await act(async () => { name.click(); });
    expect(dialog()).toBeNull();
    expect(menu()).not.toBeNull();

    // 메뉴 항목은 평소처럼 — 「휴지통으로 이동」 은 기존 휴지통 액션.
    await clickMenuItem("휴지통으로 이동");
    expect(trash.trashItemAction).toHaveBeenCalledTimes(1);
    expect((trash.trashItemAction.mock.calls[0][1] as FormData).get("itemId")).toBe("row-a");
  });

  it("짧게 누르면(탭) 메뉴 없이 평소처럼 상세가 열린다", async () => {
    const host = await mount();
    const name = nameButton(host, "리드건설");
    await pointer("pointerdown", name);
    await wait(150);
    await pointer("pointerup", name);
    await act(async () => { name.click(); });
    await wait(450);
    expect(menu()).toBeNull();
    expect(dialog()?.getAttribute("aria-label")).toBe("리드건설 상세");
  });

  it("손가락이 움직이면(스크롤·끌기) 열지 않는다", async () => {
    const host = await mount();
    const cell = host.querySelector("tbody tr[data-board-row] td:last-child")!;
    await pointer("pointerdown", cell, { x: 40, y: 30 });
    await pointer("pointermove", cell, { x: 40, y: 45 });
    await wait(550);
    expect(menu()).toBeNull();

    await pointer("pointerdown", cell, { x: 40, y: 30 });
    await pointer("pointercancel", cell, { x: 40, y: 30 });
    await wait(550);
    expect(menu()).toBeNull();
  });

  it("마우스로 오래 누르거나, 글자를 고치는 칸을 길게 누르면 열지 않는다", async () => {
    const host = await mount();
    await pointer("pointerdown", nameButton(host, "다온디자인"), { pointerType: "mouse", pointerId: 1 });
    await wait(550);
    expect(menu()).toBeNull();
    await pointer("pointerup", nameButton(host, "다온디자인"), { pointerType: "mouse", pointerId: 1 });

    const input = host.querySelector<HTMLInputElement>('tbody tr[data-board-row] input[aria-label="메모"]')!;
    await pointer("pointerdown", input);
    await wait(550);
    expect(menu()).toBeNull();
  });

  it("링크를 길게 누르면 행 메뉴 대신 기기의 링크 메뉴를 둔다", async () => {
    const fileColumn: BoardColumn = { ...textColumn, id: "col-file", key: "doc", label: "서류", type: "file" };
    const host = await mount({ columns: [fileColumn], rows: [{ ...row("row-a", "다온디자인"), values: { doc: "/api/files/sample" } }] });
    const link = host.querySelector<HTMLAnchorElement>('tbody tr[data-board-row] a[href="/api/files/sample"]')!;
    await pointer("pointerdown", link);
    await wait(550);
    expect(menu()).toBeNull();
  });

  it("브라우저가 길게 누르기에 contextmenu 도 보내면(안드로이드) 한 몸짓에 메뉴는 하나만", async () => {
    const host = await mount();
    const cell = host.querySelectorAll("tbody tr[data-board-row]")[1].querySelector("td:last-child")!;
    // 우리 타이머가 먼저 — 뒤이은 contextmenu 는 기본 메뉴만 막고 다시 열지 않는다.
    await pointer("pointerdown", cell, { x: 50, y: 60 });
    await wait(550);
    const opened = menu();
    expect(opened?.getAttribute("aria-label")).toBe("리드건설 행 메뉴");
    const late = await rightClick(cell, 50, 60);
    expect(late.defaultPrevented).toBe(true);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(menu()).toBe(opened);
    await pointer("pointerup", cell, { x: 50, y: 60 });
    await act(async () => { menu()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(menu()).toBeNull();

    // 브라우저 contextmenu 가 먼저 — 그 메뉴 하나만, 우리 타이머는 거두고, 손 뗄 때의 click 은 삼킨다.
    const name = nameButton(host, "리드건설");
    await pointer("pointerdown", name, { x: 20, y: 60 });
    await wait(100);
    const early = await rightClick(name, 20, 60);
    expect(early.defaultPrevented).toBe(true);
    const first = menu();
    expect(first?.getAttribute("aria-label")).toBe("리드건설 행 메뉴");
    await wait(500);
    expect(menu()).toBe(first);
    await pointer("pointerup", name, { x: 20, y: 60 });
    await act(async () => { name.click(); });
    expect(dialog()).toBeNull();
  });
});
