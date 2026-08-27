// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveNewLeadFinancialState } from "@/app/(app)/boards/new-lead-actions";
import { NewLeadCreditScoresCell } from "./NewLeadCreditScoresCell";

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

describe("Issue #600 합성 신용점수 leaf", () => {
  it("clean prop은 갱신하고 dirty NCB는 보존하며 최신/legacy KCB를 전송하지 않는다", async () => {
    const seen: Record<string, string>[] = [];
    const saveAction = vi.fn(async (_previous: SaveNewLeadFinancialState, formData: FormData) => {
      seen.push(Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)])));
      return { ok: true, message: "저장됨" };
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={700} kcb="legacy/kcb" readOnly={false} saveAction={saveAction} />));
    let ncb = host.querySelector<HTMLInputElement>('[aria-label="NCB 신용점수"]')!;
    let kcb = host.querySelector<HTMLInputElement>('[aria-label="KCB 신용점수"]')!;
    expect([ncb.type, ncb.value, kcb.value]).toEqual(["text", "700", "legacy/kcb"]);

    await act(async () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={701} kcb="legacy/kcb-2" readOnly={false} saveAction={saveAction} />));
    ncb = host.querySelector('[aria-label="NCB 신용점수"]')!;
    kcb = host.querySelector('[aria-label="KCB 신용점수"]')!;
    expect([ncb.value, kcb.value]).toEqual(["701", "legacy/kcb-2"]);

    await act(async () => setInput(ncb, "812"));
    await act(async () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={703} kcb="legacy/kcb-new" readOnly={false} saveAction={saveAction} />));
    ncb = host.querySelector('[aria-label="NCB 신용점수"]')!;
    kcb = host.querySelector('[aria-label="KCB 신용점수"]')!;
    expect([ncb.value, kcb.value]).toEqual(["812", "legacy/kcb-new"]);

    await blur(ncb);
    expect(seen).toEqual([{
      boardId: "board-a",
      itemId: "item-a",
      fieldKey: "credit_score_ncb",
      score: "812",
    }]);
    expect(kcb.value).toBe("legacy/kcb-new");
  });

  it("실패한 single-key intent를 정확히 한 번 재시도하고 sibling mutation은 0이다", async () => {
    const seen: Record<string, string>[] = [];
    const outcomes = [
      { ok: false, message: "일시 실패" },
      { ok: true, message: "저장됨" },
    ];
    const saveAction = vi.fn(async (_previous: SaveNewLeadFinancialState, formData: FormData) => {
      seen.push(Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)])));
      return outcomes.shift()!;
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={700} kcb={745} readOnly={false} saveAction={saveAction} />));
    const ncb = host.querySelector<HTMLInputElement>('[aria-label="NCB 신용점수"]')!;

    await act(async () => setInput(ncb, "812"));
    await blur(ncb);
    expect(ncb.value).toBe("812");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("일시 실패");

    await blur(ncb);
    expect(saveAction).toHaveBeenCalledTimes(2);
    expect(ncb.value).toBe("812");
    expect(seen.map(({ fieldKey, score }) => ({ fieldKey, score }))).toEqual([
      { fieldKey: "credit_score_ncb", score: "812" },
      { fieldKey: "credit_score_ncb", score: "812" },
    ]);
    expect(seen.every((entry) => !("kcb" in entry) && entry.fieldKey !== "credit_score_kcb")).toBe(true);
  });
});
