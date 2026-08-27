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

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
    await Promise.resolve();
  });
}

describe("Issue #600 백만원 매출 leaf", () => {
  it("invalid raw와 clean prop을 보존하고 dirty draft는 외부 refresh가 덮지 않는다", async () => {
    const statuses = vi.fn();
    const saveAction = vi.fn(async () => ({ ok: true, message: "저장됨" }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value="legacy/raw" legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    let input = host.querySelector<HTMLInputElement>('[aria-label="3개년매출"]')!;
    expect([input.type, input.value]).toEqual(["text", "legacy/raw"]);
    await blur(input);
    expect(saveAction).not.toHaveBeenCalled();

    await act(async () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value={1200} legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    input = host.querySelector('[aria-label="3개년매출"]')!;
    expect(input.value).toBe("1,200");
    await act(async () => setInput(input, "1,234"));
    await act(async () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value={1300} legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    const dirty = host.querySelector<HTMLInputElement>('[aria-label="3개년매출"]')!;
    expect(dirty.value).toBe("1,234");
    await blur(dirty);
    expect(statuses.mock.calls.map(([status]) => status)).toEqual(expect.arrayContaining(["저장 대기…", "저장 중…", "✓ 자동 저장됨"]));
  });

  it("실패한 백만원 draft를 유지하고 exact retry하며 revenue_band를 전송하지 않는다", async () => {
    const statuses = vi.fn();
    const seen: Record<string, string>[] = [];
    let releaseRetry!: (value: SaveNewLeadFinancialState) => void;
    const saveAction = vi.fn(async (_previous: SaveNewLeadFinancialState, formData: FormData) => {
      seen.push(Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)])));
      if (seen.length === 1) return { ok: false, message: "일시 실패" };
      return new Promise<SaveNewLeadFinancialState>((resolve) => { releaseRetry = resolve; });
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value={1200} legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} onStatusChange={(status) => statuses(status)} />);
    await act(async () => render());
    let input = host.querySelector<HTMLInputElement>('[aria-label="3개년매출"]')!;
    await act(async () => setInput(input, "1,234"));

    await blur(input);
    expect(input.value).toBe("1,234");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("일시 실패");
    const consumedCalls = statuses.mock.calls.length;
    await act(async () => render());
    expect(statuses).toHaveBeenCalledTimes(consumedCalls);
    input = host.querySelector<HTMLInputElement>('[aria-label="3개년매출"]')!;
    await act(async () => { setInput(input, "1,235"); setInput(input, "1,234"); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(statuses.mock.calls.at(-1)).toEqual(["저장 대기…"]);
    const form = input.form!;
    await submit(form);
    await blur(input);
    await submit(form);
    expect(saveAction).toHaveBeenCalledTimes(2);
    await act(async () => { releaseRetry({ ok: true, message: "저장됨" }); await Promise.resolve(); });
    expect(seen.map((entry) => entry.revenue3yMillion)).toEqual(["1,234", "1,234"]);
    expect(input.value).toBe("1,234");
    expect(seen.every((entry) => !("revenue_band" in entry))).toBe(true);
    expect(statuses).toHaveBeenCalledWith("저장 확인 필요");
    expect(statuses.mock.calls.at(-1)).toEqual(["✓ 자동 저장됨"]);
  });

  it("native invalid는 action 없이 inline alert와 panel 실패 상태를 남긴다", async () => {
    const statuses = vi.fn();
    const saveAction = vi.fn(async () => ({ ok: true, message: "저장됨" }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value={1200} legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    const input = host.querySelector<HTMLInputElement>('[aria-label="3개년매출"]')!;
    await act(async () => setInput(input, "1.5"));
    await blur(input);
    expect(saveAction).not.toHaveBeenCalled();
    expect(input.value).toBe("1.5");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("0 이상의 정수");
    expect(statuses.mock.calls.at(-1)).toEqual(["저장 확인 필요"]);
  });

  it("invalid 수정 뒤 valid submit 성공은 stale constraint 오류를 남기지 않는다", async () => {
    const statuses = vi.fn();
    const saveAction = vi.fn(async () => ({ ok: true, message: "저장됨" }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadRevenue3yCell boardId="board-a" itemId="item-a" value={1200} legacyRevenueBand="10~50억" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    const input = host.querySelector<HTMLInputElement>('[aria-label="3개년매출"]')!;

    await act(async () => setInput(input, "1.5"));
    await blur(input);
    expect(saveAction).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("0 이상의 정수");

    await act(async () => setInput(input, "1,234"));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await blur(input);
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(statuses.mock.calls.at(-1)).toEqual(["✓ 자동 저장됨"]);
  });
});
