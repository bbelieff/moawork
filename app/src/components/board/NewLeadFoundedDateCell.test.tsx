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
    // 달력 칸은 읽을 수 없는 옛 글자를 비워 보이지만, 손대지 않으면 저장하지 않는다(옛 값 보존).
    expect(input.type).toBe("date");
    await blur(input);
    expect(saveAction).not.toHaveBeenCalled();

    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-08" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    input = host.querySelector('[aria-label="창업연월"]')!;
    // 2026-10-17 belie: 연월만 있으면 일은 1로 채워 달력에 보인다.
    expect(input.value).toBe("2026-08-01");
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

  it("저장 실패(action reject)를 칸 아래에 알리고 draft를 유지한다", async () => {
    const statuses = vi.fn();
    const saveAction = vi.fn(async () => { throw new Error("network"); });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-08" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    const input = host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!;
    await act(async () => setInput(input, "2026-08-27"));
    await blur(input);
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("2026-08-27");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("다시 시도");
    expect(statuses.mock.calls.at(-1)).toEqual(["저장 확인 필요"]);
  });

  it("연도만 있는 리드는 1월 1일로 채워 보여 준다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2019" readOnly={false} saveAction={vi.fn()} />));
    expect(host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!.value).toBe("2019-01-01");
  });
});
