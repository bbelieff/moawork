// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn } from "@/lib/boards/types";
import type { BoardSummaryMetricConfig } from "@/lib/boards/summary";
import { BoardSummarySettingsPopover } from "./BoardSummarySettingsPopover";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function column(key: string, label: string, type: BoardColumn["type"], summaryHidden = false): BoardColumn {
  return { id: key, org_id: "org", board_id: "board", key, label, type, source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null, summary_hidden: summaryHidden };
}

const columns = [
  column("status", "상담상황", "status"),
  column("amount", "계약금", "money"),
  column("revenue", "매출", "money"),
  column("quantity", "수량", "number", true),
  column("memo", "메모", "text"),
];

async function mount(config: BoardSummaryMetricConfig[] = [{ id: "status", kind: "distribution", columnKey: "status" }]) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const callbacks = { onAdd: vi.fn(), onRemove: vi.fn(), onMove: vi.fn() };
  await act(async () => root?.render(<BoardSummarySettingsPopover config={config} columns={columns} {...callbacks} />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  await act(async () => trigger.click());
  return { host, trigger, dialog: document.body.querySelector<HTMLElement>('[role="dialog"]')!, callbacks };
}

describe("Issue #605 BoardSummarySettingsPopover", () => {
  it("opens in a body portal and restores trigger focus on Escape", async () => {
    const { trigger, dialog } = await mount();
    expect(dialog.closest("body")).toBe(document.body);
    expect(dialog.textContent).toContain("보드 공통 지표를 최대 3개");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => Promise.resolve());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("emits add, remove and ordered move callbacks without pretending to persist", async () => {
    const { dialog, callbacks } = await mount();
    const amount = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("계약금"))!;
    await act(async () => amount.click());
    expect(callbacks.onAdd).toHaveBeenCalledWith({ id: "sum:amount", kind: "sum", columnKey: "amount" });

    const remove = dialog.querySelector<HTMLButtonElement>('[aria-label="상담상황 요약 제거"]')!;
    await act(async () => remove.click());
    expect(callbacks.onRemove).toHaveBeenCalledWith("status");
  });

  it("reorders selected metrics and excludes hidden or unsupported candidates", async () => {
    const { dialog, callbacks } = await mount([
      { id: "status", kind: "distribution", columnKey: "status" },
      { id: "amount", kind: "sum", columnKey: "amount" },
    ]);
    const down = dialog.querySelector<HTMLButtonElement>('[aria-label="상담상황 아래로"]')!;
    await act(async () => down.click());
    expect(callbacks.onMove).toHaveBeenCalledWith("status", 1);
    expect(dialog.textContent).not.toContain("수량");
    expect(dialog.textContent).not.toContain("메모");
  });

  it("disables additions at the maximum of three", async () => {
    const { dialog } = await mount([
      { id: "one", kind: "distribution", columnKey: "status" },
      { id: "two", kind: "sum", columnKey: "amount" },
      { id: "three", kind: "sum", columnKey: "other" },
    ]);
    expect(dialog.textContent).toContain("최대 3개를 사용 중입니다");
    const revenue = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("매출"))!;
    expect(revenue.disabled).toBe(true);
  });
});
