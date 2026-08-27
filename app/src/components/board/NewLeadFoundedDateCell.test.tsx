// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveNewLeadFinancialState } from "@/app/(app)/boards/new-lead-actions";
import { NewLeadFoundedDateCell } from "./NewLeadFoundedDateCell";

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

describe("Issue #600 정밀도 보존 창업일 leaf", () => {
  it("invalid raw와 clean 외부 갱신을 보존하고 dirty draft는 rerender가 덮지 않는다", async () => {
    const statuses = vi.fn();
    const saveAction = vi.fn(async () => ({ ok: true, message: "저장됨" }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="legacy/raw" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    let input = host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!;
    expect(input.value).toBe("legacy/raw");
    await blur(input);
    expect(saveAction).not.toHaveBeenCalled();

    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-08" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    input = host.querySelector('[aria-label="창업연월"]')!;
    expect(input.value).toBe("2026-08");
    await act(async () => setInput(input, "2026-08-27"));
    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-09" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    const dirty = host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!;
    expect(dirty.value).toBe("2026-08-27");
    await blur(dirty);
    expect(statuses.mock.calls.map(([status]) => status)).toEqual(expect.arrayContaining(["저장 대기…", "저장 중…", "✓ 자동 저장됨"]));
  });

  it("실패한 exact 날짜 draft를 유지하고 다음 blur에서 한 번 재시도한다", async () => {
    const statuses = vi.fn();
    const seen: string[] = [];
    let releaseRetry!: (value: SaveNewLeadFinancialState) => void;
    const saveAction = vi.fn(async (_previous: SaveNewLeadFinancialState, formData: FormData) => {
      seen.push(String(formData.get("foundedDate")));
      if (seen.length === 1) return { ok: false, message: "일시 실패" };
      return new Promise<SaveNewLeadFinancialState>((resolve) => { releaseRetry = resolve; });
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-08" readOnly={false} saveAction={saveAction} onStatusChange={(status) => statuses(status)} />);
    await act(async () => render());
    let input = host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!;
    await act(async () => setInput(input, "2026-08-27"));

    await blur(input);
    expect(input.value).toBe("2026-08-27");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("일시 실패");
    const consumedCalls = statuses.mock.calls.length;
    await act(async () => render());
    expect(statuses).toHaveBeenCalledTimes(consumedCalls);
    input = host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!;
    await act(async () => { setInput(input, "2026-08-28"); setInput(input, "2026-08-27"); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(statuses.mock.calls.at(-1)).toEqual(["저장 대기…"]);
    const form = input.form!;
    await submit(form);
    await blur(input);
    await submit(form);
    expect(saveAction).toHaveBeenCalledTimes(2);
    await act(async () => { releaseRetry({ ok: true, message: "저장됨" }); await Promise.resolve(); });
    expect(seen).toEqual(["2026-08-27", "2026-08-27"]);
    expect(input.value).toBe("2026-08-27");
    expect(statuses).toHaveBeenCalledWith("저장 확인 필요");
    expect(statuses.mock.calls.at(-1)).toEqual(["✓ 자동 저장됨"]);
  });

  it("native invalid와 action reject를 inline·panel 실패로 보고하고 draft를 유지한다", async () => {
    const statuses = vi.fn();
    const saveAction = vi.fn(async () => { throw new Error("network"); });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-08" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    const input = host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!;
    await act(async () => setInput(input, "2026-13"));
    await blur(input);
    expect(saveAction).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("YYYY-MM");
    expect(statuses.mock.calls.at(-1)).toEqual(["저장 확인 필요"]);

    await act(async () => setInput(input, "2026-08-27"));
    await blur(input);
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("2026-08-27");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("다시 시도");
    expect(statuses.mock.calls.at(-1)).toEqual(["저장 확인 필요"]);
  });

  it("invalid 수정 뒤 valid submit 성공은 stale constraint 오류를 남기지 않는다", async () => {
    const statuses = vi.fn();
    const saveAction = vi.fn(async () => ({ ok: true, message: "저장됨" }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-08" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    const input = host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!;

    await act(async () => setInput(input, "2026-13"));
    await blur(input);
    expect(saveAction).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("YYYY-MM");

    await act(async () => setInput(input, "2026-08-27"));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await blur(input);
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(statuses.mock.calls.at(-1)).toEqual(["✓ 자동 저장됨"]);
  });
});
