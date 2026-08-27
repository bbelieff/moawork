// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveNewLeadFinancialState } from "@/app/(app)/boards/new-lead-actions";
import { NewLeadRevenue3yCell } from "./NewLeadRevenue3yCell";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function blur(input: HTMLInputElement) {
  await act(async () => {
    input.focus();
    input.blur();
    await Promise.resolve();
  });
}

describe("Issue #600 백만원 매출 leaf", () => {
  it("invalid raw와 clean prop을 보존하고 dirty draft는 외부 refresh가 덮지 않는다", async () => {
    const saveAction = vi.fn(async () => ({ ok: true, message: "저장됨" }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value="legacy/raw" legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} />));
    let input = host.querySelector<HTMLInputElement>('[aria-label="3개년매출"]')!;
    expect([input.type, input.value]).toEqual(["text", "legacy/raw"]);
    await blur(input);
    expect(saveAction).not.toHaveBeenCalled();

    await act(async () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value={1200} legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} />));
    input = host.querySelector('[aria-label="3개년매출"]')!;
    expect(input.value).toBe("1,200");
    await act(async () => setInput(input, "1,234"));
    await act(async () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value={1300} legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} />));
    expect(host.querySelector<HTMLInputElement>('[aria-label="3개년매출"]')?.value).toBe("1,234");
  });

  it("실패한 백만원 draft를 유지하고 exact retry하며 revenue_band를 전송하지 않는다", async () => {
    const seen: Record<string, string>[] = [];
    const outcomes = [{ ok: false, message: "일시 실패" }, { ok: true, message: "저장됨" }];
    const saveAction = vi.fn(async (_previous: SaveNewLeadFinancialState, formData: FormData) => {
      seen.push(Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)])));
      return outcomes.shift()!;
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value={1200} legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} />));
    const input = host.querySelector<HTMLInputElement>('[aria-label="3개년매출"]')!;
    await act(async () => setInput(input, "1,234"));

    await blur(input);
    expect(input.value).toBe("1,234");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("일시 실패");
    await blur(input);
    expect(seen.map((entry) => entry.revenue3yMillion)).toEqual(["1,234", "1,234"]);
    expect(input.value).toBe("1,234");
    expect(seen.every((entry) => !("revenue_band" in entry))).toBe(true);
  });
});
