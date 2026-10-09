// @vitest-environment jsdom
/**
 * #845 개선안(2026-10-08) — 표의 「열기」「삭제」 단추를 걷어 낸 대신 상세가 맡는 두 가지.
 *   · 제목(업체명)을 눌러 바로 고친다 — 표 칸이 쓰던 기존 저장 액션 그대로.
 *   · ⋯ 메뉴의 마지막 「휴지통으로 이동」(행 삭제와 같은 권한일 때만) — 상세를 닫고 기존 휴지통 액션.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trashItemAction: vi.fn(),
  restoreItemAction: vi.fn(),
  renameItemAction: vi.fn(),
  updateNewLeadTitleAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/trash-actions", () => ({
  trashItemAction: mocks.trashItemAction,
  restoreItemAction: mocks.restoreItemAction,
}));
vi.mock("@/app/(app)/boards/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/boards/actions")>()),
  renameItemAction: mocks.renameItemAction,
}));
vi.mock("@/app/(app)/boards/new-lead-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/boards/new-lead-actions")>()),
  updateNewLeadTitleAction: mocks.updateNewLeadTitleAction,
}));

import { ItemDetailPanel } from "./ItemDetailPanel";
import type { ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  mocks.trashItemAction.mockReset().mockResolvedValue({ ok: true, message: "항목을 휴지통으로 옮겼습니다." });
  mocks.restoreItemAction.mockReset().mockResolvedValue({ ok: true, message: null });
  mocks.renameItemAction.mockReset().mockResolvedValue(undefined);
  mocks.updateNewLeadTitleAction.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", window.location.pathname);
});

const baseRow: ItemWithValues = {
  id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a", title: "대한정밀",
  assigned_to: null, deal_id: null, sort_order: 0,
  created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z", values: {},
};

async function openPanel({
  canTrash = false,
  canEditItems = true,
  canonicalNewLead = false,
  row = baseRow,
}: { canTrash?: boolean; canEditItems?: boolean; canonicalNewLead?: boolean; row?: ItemWithValues } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <ItemDetailPanel
      boardId="board-a"
      row={row}
      columns={[]}
      boardLayout={[]}
      layout={[]}
      inherited
      canEditItems={canEditItems}
      canManageColumns={false}
      canonicalNewLead={canonicalNewLead}
      canTrash={canTrash}
      titleNoun="업체명"
      initialDetail={{ ok: true, events: [], links: [], files: [], members: [] }}
    />,
  ));
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="대한정밀 상세 열기"]')!.click(); });
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog!;
}

const moreItems = (dialog: HTMLElement) => {
  const menu = dialog.querySelector('summary[aria-label="회사 상세 추가 메뉴"]')!.parentElement!;
  return [...menu.querySelectorAll<HTMLButtonElement>("button")].map((button) => button.textContent?.trim());
};

describe("상세 ⋯ 메뉴 「휴지통으로 이동」", () => {
  it("권한이 있으면 마지막 항목으로 있다", async () => {
    const dialog = await openPanel({ canTrash: true });
    expect(moreItems(dialog)).toEqual(["TXT 내려받기", "CSV 내려받기", "회사 정보 복사", "휴지통으로 이동"]);
    expect(dialog.querySelector("[data-item-detail-trash]")?.className).toMatch(/moreDanger/);
  });

  it("권한이 없으면 없다", async () => {
    const dialog = await openPanel({ canTrash: false });
    expect(moreItems(dialog)).toEqual(["TXT 내려받기", "CSV 내려받기", "회사 정보 복사"]);
    expect(dialog.querySelector("[data-item-detail-trash]")).toBeNull();
  });

  it("누르면 상세를 닫고 기존 휴지통 액션을 부른다", async () => {
    const dialog = await openPanel({ canTrash: true });
    await act(async () => { dialog.querySelector<HTMLButtonElement>("[data-item-detail-trash]")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.trashItemAction).toHaveBeenCalledTimes(1);
    const sent = mocks.trashItemAction.mock.calls[0][1] as FormData;
    expect([sent.get("boardId"), sent.get("itemId")]).toEqual(["board-a", "item-a"]);
    expect(window.location.hash).toBe("");
  });
});

describe("상세 제목 — 눌러서 바로 고치기", () => {
  it("제목을 누르면 고치는 칸이 되고, Enter 로 기존 이름 저장 액션을 부른다", async () => {
    const dialog = await openPanel();
    const title = dialog.querySelector<HTMLButtonElement>("h2 button[data-item-detail-title]")!;
    expect(title.textContent).toBe("대한정밀");
    await act(async () => { title.click(); });
    const input = dialog.querySelector<HTMLInputElement>("input[data-item-detail-title-input]")!;
    expect(input.getAttribute("aria-label")).toBe("업체명");
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "대한정밀 2공장");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(mocks.renameItemAction).toHaveBeenCalledTimes(1);
    const sent = mocks.renameItemAction.mock.calls[0][0] as FormData;
    expect([sent.get("boardId"), sent.get("itemId"), sent.get("title"), sent.get("dealId")]).toEqual(["board-a", "item-a", "대한정밀 2공장", null]);
    expect(mocks.updateNewLeadTitleAction).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("Esc 는 고치던 이름만 되돌리고 상세는 닫지 않는다", async () => {
    const dialog = await openPanel();
    await act(async () => { dialog.querySelector<HTMLButtonElement>("h2 button[data-item-detail-title]")!.click(); });
    const input = dialog.querySelector<HTMLInputElement>("input[data-item-detail-title-input]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "바뀐 이름");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(dialog.querySelector("input[data-item-detail-title-input]")).toBeNull();
    expect(dialog.querySelector("h2")?.textContent).toBe("대한정밀");
    expect(mocks.renameItemAction).not.toHaveBeenCalled();
  });

  it("비우면 저장하지 않고 그 자리에서 알린다", async () => {
    const dialog = await openPanel();
    await act(async () => { dialog.querySelector<HTMLButtonElement>("h2 button[data-item-detail-title]")!.click(); });
    const input = dialog.querySelector<HTMLInputElement>("input[data-item-detail-title-input]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "   ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(mocks.renameItemAction).not.toHaveBeenCalled();
    expect(dialog.querySelector('[data-item-detail-title-error][role="alert"]')?.textContent).toBe("업체명을 비울 수는 없어요.");
  });

  it("신규리드 표준 행(deal 연결)은 기존 신규리드 이름 액션으로 저장한다", async () => {
    const dialog = await openPanel({ canonicalNewLead: true, row: { ...baseRow, deal_id: "deal-a" } });
    await act(async () => { dialog.querySelector<HTMLButtonElement>("h2 button[data-item-detail-title]")!.click(); });
    const input = dialog.querySelector<HTMLInputElement>("input[data-item-detail-title-input]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "대한정밀(주)");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.blur(); });
    expect(mocks.updateNewLeadTitleAction).toHaveBeenCalledTimes(1);
    const sent = mocks.updateNewLeadTitleAction.mock.calls[0][0] as FormData;
    expect([sent.get("itemId"), sent.get("dealId"), sent.get("title")]).toEqual(["item-a", "deal-a", "대한정밀(주)"]);
    expect(mocks.renameItemAction).not.toHaveBeenCalled();
  });

  it("고칠 권한이 없으면 제목은 글자일 뿐이다", async () => {
    const dialog = await openPanel({ canEditItems: false });
    expect(dialog.querySelector("h2")?.textContent).toBe("대한정밀");
    expect(dialog.querySelector("h2 button")).toBeNull();
  });
});
