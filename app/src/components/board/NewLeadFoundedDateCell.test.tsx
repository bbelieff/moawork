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

describe("Issue #600 정밀도 보존 창업일 leaf", () => {
  it("invalid raw와 clean 외부 갱신을 보존하고 dirty draft는 rerender가 덮지 않는다", async () => {
    const saveAction = vi.fn(async () => ({ ok: true, message: "저장됨" }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="legacy/raw" readOnly={false} saveAction={saveAction} />));
    let input = host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!;
    expect(input.value).toBe("legacy/raw");
    await blur(input);
    expect(saveAction).not.toHaveBeenCalled();

    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-08" readOnly={false} saveAction={saveAction} />));
    input = host.querySelector('[aria-label="창업연월"]')!;
    expect(input.value).toBe("2026-08");
    await act(async () => setInput(input, "2026-08-27"));
    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-09" readOnly={false} saveAction={saveAction} />));
    expect(host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')?.value).toBe("2026-08-27");
  });

  it("실패한 exact 날짜 draft를 유지하고 다음 blur에서 한 번 재시도한다", async () => {
    const seen: string[] = [];
    const outcomes = [{ ok: false, message: "일시 실패" }, { ok: true, message: "저장됨" }];
    const saveAction = vi.fn(async (_previous: SaveNewLeadFinancialState, formData: FormData) => {
      seen.push(String(formData.get("foundedDate")));
      return outcomes.shift()!;
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadFoundedDateCell boardId="board-a" itemId="item-a" value="2026-08" readOnly={false} saveAction={saveAction} />));
    const input = host.querySelector<HTMLInputElement>('[aria-label="창업연월"]')!;
    await act(async () => setInput(input, "2026-08-27"));

    await blur(input);
    expect(input.value).toBe("2026-08-27");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("일시 실패");
    await blur(input);
    expect(seen).toEqual(["2026-08-27", "2026-08-27"]);
    expect(input.value).toBe("2026-08-27");
  });
});
