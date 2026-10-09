// @vitest-environment jsdom
/**
 * #845 개선안(2026-10-08) — 행을 휴지통으로 옮긴 뒤의 「되돌리기」 알림.
 *   「「이름」을 휴지통으로 옮겼어요 · 되돌리기」 를 약 8초, 마우스를 올리면 멈추고, 되돌리기 실패는 알림 안에서 말한다.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trash = vi.hoisted(() => ({ trashItemAction: vi.fn(), restoreItemAction: vi.fn() }));
vi.mock("@/app/(app)/boards/trash-actions", () => trash);

import { ITEM_TRASH_UNDO_MS, ItemTrashUndoToast, moveItemToTrash } from "./ItemTrashUndo";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  trash.trashItemAction.mockReset().mockResolvedValue({ ok: true, message: "항목을 휴지통으로 옮겼습니다." });
  trash.restoreItemAction.mockReset().mockResolvedValue({ ok: true, message: "항목을 원래 위치로 복구했습니다." });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function mountToast(boardId = "b1") {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ItemTrashUndoToast boardId={boardId} />));
}

const toast = () => document.querySelector<HTMLElement>("[data-item-trash-toast]");
const live = (kind: "status" | "alert") => document.querySelector<HTMLElement>(`[data-item-trash-live="${kind}"]`);
const undoButton = () => [...(toast()?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "되돌리기");

describe("되돌리기 알림", () => {
  it("받침에 맞춘 조사로 말하고 약 8초 뒤 사라진다", async () => {
    expect(ITEM_TRASH_UNDO_MS).toBe(8000);
    await mountToast();
    await act(async () => { await moveItemToTrash({ boardId: "b1", itemId: "i1", title: "리드건설" }); });
    expect(toast()?.textContent).toContain("「리드건설」을 휴지통으로 옮겼어요");
    await act(async () => { await moveItemToTrash({ boardId: "b1", itemId: "i2", title: "다온카페" }); });
    expect(toast()?.textContent).toContain("「다온카페」를 휴지통으로 옮겼어요");
    await act(async () => { vi.advanceTimersByTime(ITEM_TRASH_UNDO_MS - 100); });
    expect(toast()).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(toast()).toBeNull();
  });

  it("마우스를 올려 둔 동안은 사라지지 않는다", async () => {
    await mountToast();
    await act(async () => { await moveItemToTrash({ boardId: "b1", itemId: "i1", title: "다온디자인" }); });
    await act(async () => { toast()!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })); });
    await act(async () => { vi.advanceTimersByTime(ITEM_TRASH_UNDO_MS * 2); });
    expect(toast()).not.toBeNull();
    await act(async () => { toast()!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); });
    await act(async () => { vi.advanceTimersByTime(ITEM_TRASH_UNDO_MS + 10); });
    expect(toast()).toBeNull();
  });

  it("되돌리기가 실패하면 사유를 알림 안에서 말하고 다시 누를 수 있다", async () => {
    trash.restoreItemAction.mockResolvedValueOnce({ ok: false, message: "이 항목을 삭제하거나 복구할 권한이 없습니다." });
    await mountToast();
    await act(async () => { await moveItemToTrash({ boardId: "b1", itemId: "i1", title: "다온디자인" }); });
    await act(async () => { undoButton()!.click(); });
    expect(live("alert")?.textContent).toBe("이 항목을 삭제하거나 복구할 권한이 없습니다.");
    expect(live("status")?.textContent).toBe("");
    expect(toast()?.textContent).toContain("이 항목을 삭제하거나 복구할 권한이 없습니다.");
    await act(async () => { undoButton()!.click(); });
    expect(trash.restoreItemAction).toHaveBeenCalledTimes(2);
    expect(toast()).toBeNull();
  });

  it("알림 영역은 늘 붙어 있고 글자만 바뀐다 — 성공은 status(polite), 실패는 alert, 사라지면 비운다", async () => {
    await mountToast();
    const status = live("status")!;
    const alert = live("alert")!;
    expect([status.getAttribute("role"), status.getAttribute("aria-live"), status.textContent]).toEqual(["status", "polite", ""]);
    expect([alert.getAttribute("role"), alert.getAttribute("aria-live"), alert.textContent]).toEqual(["alert", "assertive", ""]);

    await act(async () => { await moveItemToTrash({ boardId: "b1", itemId: "i1", title: "리드건설" }); });
    // 같은 노드에 글자만 들어간다(새로 붙이지 않는다). 보이는 알림은 live 속성을 두지 않아 두 번 읽히지 않는다.
    expect(live("status")).toBe(status);
    expect(status.textContent).toBe("「리드건설」을 휴지통으로 옮겼어요");
    expect(toast()?.hasAttribute("aria-live")).toBe(false);
    expect(toast()?.hasAttribute("role")).toBe(false);

    await act(async () => { vi.advanceTimersByTime(ITEM_TRASH_UNDO_MS + 10); });
    expect(toast()).toBeNull();
    expect(live("status")).toBe(status);
    expect(status.textContent).toBe("");
  });

  it("다른 보드의 알림은 띄우지 않고, 닫기로 바로 걷는다", async () => {
    await mountToast("b1");
    await act(async () => { await moveItemToTrash({ boardId: "b2", itemId: "i1", title: "다른 보드" }); });
    expect(toast()).toBeNull();
    await act(async () => { await moveItemToTrash({ boardId: "b1", itemId: "i1", title: "다온디자인" }); });
    await act(async () => { toast()!.querySelector<HTMLButtonElement>('[aria-label="알림 닫기"]')!.click(); });
    expect(toast()).toBeNull();
  });
});
