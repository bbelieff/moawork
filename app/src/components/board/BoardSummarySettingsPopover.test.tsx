// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function mount(
  config: BoardSummaryMetricConfig[] = [{ id: "status", kind: "distribution", columnKey: "status" }],
  overrides: Partial<ComponentProps<typeof BoardSummarySettingsPopover>> = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const defaultSubmit = vi.fn(async (request: Parameters<NonNullable<ComponentProps<typeof BoardSummarySettingsPopover>["onSubmit"]>>[0]) => ({ ok: true as const, requestId: request.requestId }));
  const onSubmit = overrides.onSubmit ?? defaultSubmit;
  await act(async () => root?.render(
    <BoardSummarySettingsPopover
      config={config}
      columns={columns}
      canEdit
      onSubmit={onSubmit}
      {...overrides}
    />,
  ));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  await act(async () => trigger.click());
  return { host, trigger, dialog: document.body.querySelector<HTMLElement>('[role="dialog"]')!, onSubmit };
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
    const { dialog, onSubmit } = await mount();
    const amount = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("계약금"))!;
    await act(async () => amount.click());
    expect(onSubmit).toHaveBeenNthCalledWith(1, {
      requestId: expect.stringMatching(UUID_PATTERN),
      intent: { type: "add", metric: { id: "sum:amount", kind: "sum", columnKey: "amount" } },
    });

    const remove = dialog.querySelector<HTMLButtonElement>('[aria-label="상담상황 요약 제거"]')!;
    await act(async () => remove.click());
    expect(onSubmit).toHaveBeenNthCalledWith(2, {
      requestId: expect.stringMatching(UUID_PATTERN),
      intent: { type: "remove", metricId: "status" },
    });
  });

  it("reorders selected metrics and excludes hidden or unsupported candidates", async () => {
    const { dialog, onSubmit } = await mount([
      { id: "status", kind: "distribution", columnKey: "status" },
      { id: "amount", kind: "sum", columnKey: "amount" },
    ]);
    const down = dialog.querySelector<HTMLButtonElement>('[aria-label="상담상황 아래로"]')!;
    await act(async () => down.click());
    expect(onSubmit).toHaveBeenCalledWith({
      requestId: expect.stringMatching(UUID_PATTERN),
      intent: { type: "move", metricId: "status", direction: 1 },
    });
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

  it("prevents duplicate actions while pending and preserves order for a retry with the same request id", async () => {
    let resolveFirst: ((result: { ok: false; requestId: string; error: string }) => void) | undefined;
    const onSubmit = vi.fn((_request: { requestId: string }) => {
      void _request;
      return new Promise<{ ok: false; requestId: string; error: string }>((resolve) => {
        resolveFirst = resolve;
      });
    });
    const { dialog } = await mount([
      { id: "status", kind: "distribution", columnKey: "status" },
      { id: "amount", kind: "sum", columnKey: "amount" },
    ], { onSubmit });
    const remove = dialog.querySelector<HTMLButtonElement>('[aria-label="상담상황 요약 제거"]')!;

    await act(async () => {
      remove.click();
      remove.click();
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(remove.disabled).toBe(true);
    expect(dialog.textContent).toContain("저장 중");

    const firstRequest = onSubmit.mock.calls[0][0];
    await act(async () => resolveFirst?.({ ok: false, requestId: firstRequest.requestId, error: "저장 실패" }));
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("저장 실패");
    expect(dialog.querySelector('[role="alert"]')?.getAttribute("aria-live")).toBe("assertive");
    expect(dialog.textContent).toContain("상담상황 · 분포");
    expect(dialog.textContent).toContain("계약금 · 합계");
    expect(remove.disabled).toBe(false);

    await act(async () => remove.click());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0].requestId).toBe(firstRequest.requestId);
  });

  it("keeps mutation controls disabled without permission", async () => {
    const denied = await mount(undefined, { canEdit: false });
    const deniedRemove = denied.dialog.querySelector<HTMLButtonElement>('[aria-label="상담상황 요약 제거"]')!;
    expect(denied.dialog.textContent).toContain("변경할 권한이 없습니다");
    expect(deniedRemove.disabled).toBe(true);
  });

  it("keeps mutation controls disabled during controlled pending", async () => {
    const pending = await mount(undefined, { pending: true });
    const pendingRemove = pending.dialog.querySelector<HTMLButtonElement>('[aria-label="상담상황 요약 제거"]')!;
    expect(pending.dialog.getAttribute("aria-busy")).toBe("true");
    expect(pendingRemove.disabled).toBe(true);
  });
});
