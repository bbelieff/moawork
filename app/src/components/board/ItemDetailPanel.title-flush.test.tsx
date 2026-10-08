// @vitest-environment jsdom
/**
 * #845 — 상세 제목(업체명)을 고치다 바깥을 누르거나 닫으면, 입력칸은 blur 없이 사라진다.
 * 고치던 이름은 닫히는 그때 한 번 저장한다(칸을 떠나 이미 저장했으면 다시 저장하지 않는다).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renameItemAction: vi.fn(),
  updateNewLeadTitleAction: vi.fn(),
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
  mocks.renameItemAction.mockReset().mockResolvedValue(undefined);
  mocks.updateNewLeadTitleAction.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", window.location.pathname);
});

const row: ItemWithValues = {
  id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a", title: "대한정밀",
  assigned_to: null, deal_id: null, sort_order: 0,
  created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z", values: {},
};

async function openPanel() {
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
      canEditItems
      canManageColumns={false}
      titleNoun="업체명"
      initialDetail={{ ok: true, events: [], links: [], files: [], members: [] }}
    />,
  ));
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="대한정밀 상세 열기"]')!.click(); });
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await act(async () => { dialog.querySelector<HTMLButtonElement>("h2 button[data-item-detail-title]")!.click(); });
  return { dialog, input: dialog.querySelector<HTMLInputElement>("input[data-item-detail-title-input]")! };
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const sentTitles = () => mocks.renameItemAction.mock.calls.map(([data]) => (data as FormData).get("title"));

describe("상세 제목 — 고치다 닫아도 남는다", () => {
  it("바깥(덮개)을 누르면 닫히면서 고치던 이름을 한 번 저장한다", async () => {
    const { dialog, input } = await openPanel();
    await typeInto(input, "대한정밀 2공장");
    await act(async () => { dialog.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(sentTitles()).toEqual(["대한정밀 2공장"]);
  });

  it("× 로 닫아도 저장하고, 다시 열면 고치던 칸이 남아 있지 않다", async () => {
    const { dialog, input } = await openPanel();
    await typeInto(input, "대한정밀(주)");
    await act(async () => { dialog.querySelector<HTMLButtonElement>('button[aria-label="상세 닫기"]')!.click(); });
    expect(sentTitles()).toEqual(["대한정밀(주)"]);
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="대한정밀 상세 열기"]')!.click(); });
    expect(document.querySelector("input[data-item-detail-title-input]")).toBeNull();
  });

  it("칸을 떠나 이미 저장했거나 비웠으면 닫을 때 다시 저장하지 않는다", async () => {
    const first = await openPanel();
    await typeInto(first.input, "한 번만");
    await act(async () => { first.input.blur(); });
    await act(async () => { first.dialog.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(sentTitles()).toEqual(["한 번만"]);

    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    window.history.replaceState(null, "", window.location.pathname);
    const second = await openPanel();
    await typeInto(second.input, "   ");
    await act(async () => { second.dialog.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(sentTitles()).toEqual(["한 번만"]);
  });
});
