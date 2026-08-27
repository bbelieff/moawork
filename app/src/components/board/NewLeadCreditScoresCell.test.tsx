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

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
    await Promise.resolve();
  });
}

describe("Issue #600 합성 신용점수 leaf", () => {
  it("clean prop은 갱신하고 dirty NCB는 보존하며 최신/legacy KCB를 전송하지 않는다", async () => {
    const statuses = vi.fn();
    const seen: Record<string, string>[] = [];
    const saveAction = vi.fn(async (_previous: SaveNewLeadFinancialState, formData: FormData) => {
      seen.push(Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)])));
      return { ok: true, message: "저장됨" };
    });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={700} kcb="legacy/kcb" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    let ncb = host.querySelector<HTMLInputElement>('[aria-label="NCB 신용점수"]')!;
    let kcb = host.querySelector<HTMLInputElement>('[aria-label="KCB 신용점수"]')!;
    expect([ncb.type, ncb.value, kcb.value]).toEqual(["text", "700", "legacy/kcb"]);

    await act(async () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={701} kcb="legacy/kcb-2" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    ncb = host.querySelector('[aria-label="NCB 신용점수"]')!;
    kcb = host.querySelector('[aria-label="KCB 신용점수"]')!;
    expect([ncb.value, kcb.value]).toEqual(["701", "legacy/kcb-2"]);

    await act(async () => setInput(ncb, "812"));
    await act(async () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={703} kcb="legacy/kcb-new" readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
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
    expect(statuses.mock.calls.filter(([key]) => key === "credit_score_ncb").map(([, status]) => status))
      .toEqual(expect.arrayContaining(["저장 대기…", "저장 중…", "✓ 자동 저장됨"]));
  });

  it("실패한 single-key intent를 정확히 한 번 재시도하고 sibling mutation은 0이다", async () => {
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
    const render = () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={700} kcb={745} readOnly={false} saveAction={saveAction} onStatusChange={(key, status) => statuses(key, status)} />);
    await act(async () => render());
    let ncb = host.querySelector<HTMLInputElement>('[aria-label="NCB 신용점수"]')!;

    await act(async () => setInput(ncb, "812"));
    await blur(ncb);
    expect(ncb.value).toBe("812");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("일시 실패");

    const consumedCalls = statuses.mock.calls.length;
    await act(async () => render());
    expect(statuses).toHaveBeenCalledTimes(consumedCalls);
    ncb = host.querySelector<HTMLInputElement>('[aria-label="NCB 신용점수"]')!;
    await act(async () => { setInput(ncb, "813"); setInput(ncb, "812"); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(statuses.mock.calls.at(-1)).toEqual(["credit_score_ncb", "저장 대기…"]);
    const form = ncb.form!;
    await submit(form);
    await blur(ncb);
    await submit(form);
    expect(saveAction).toHaveBeenCalledTimes(2);
    await act(async () => { releaseRetry({ ok: true, message: "저장됨" }); await Promise.resolve(); });
    expect(ncb.value).toBe("812");
    expect(seen.map(({ fieldKey, score }) => ({ fieldKey, score }))).toEqual([
      { fieldKey: "credit_score_ncb", score: "812" },
      { fieldKey: "credit_score_ncb", score: "812" },
    ]);
    expect(seen.every((entry) => !("kcb" in entry) && entry.fieldKey !== "credit_score_kcb")).toBe(true);
    expect(statuses).toHaveBeenCalledWith("credit_score_ncb", "저장 확인 필요");
    expect(statuses.mock.calls.at(-1)).toEqual(["credit_score_ncb", "✓ 자동 저장됨"]);
  });

  it("NCB 실패와 KCB 성공을 독립 상태로 보고하고 한쪽 값으로 sibling을 덮지 않는다", async () => {
    const statuses = vi.fn();
    const saveAction = vi.fn(async (_previous: SaveNewLeadFinancialState, formData: FormData) =>
      formData.get("fieldKey") === "credit_score_ncb"
        ? { ok: false, message: "NCB 실패" }
        : { ok: true, message: "저장됨" });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={700} kcb={745} readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    const ncb = host.querySelector<HTMLInputElement>('[aria-label="NCB 신용점수"]')!;
    const kcb = host.querySelector<HTMLInputElement>('[aria-label="KCB 신용점수"]')!;
    await act(async () => setInput(ncb, "812"));
    await blur(ncb);
    await act(async () => setInput(kcb, "760"));
    await blur(kcb);
    expect(statuses).toHaveBeenCalledWith("credit_score_ncb", "저장 확인 필요");
    expect(statuses).toHaveBeenCalledWith("credit_score_kcb", "✓ 자동 저장됨");
    expect(saveAction.mock.calls.map(([, formData]) => String((formData as FormData).get("fieldKey"))))
      .toEqual(["credit_score_ncb", "credit_score_kcb"]);
  });

  it("native invalid는 action 0·inline alert·panel 실패 상태이며 pending 중 중복 submit도 0이다", async () => {
    let release!: (value: SaveNewLeadFinancialState) => void;
    const statuses = vi.fn();
    const saveAction = vi.fn(() => new Promise<SaveNewLeadFinancialState>((resolve) => { release = resolve; }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadCreditScoresCell boardId="board-a" itemId="item-a" ncb={700} kcb={745} readOnly={false} saveAction={saveAction} onStatusChange={statuses} />));
    const ncb = host.querySelector<HTMLInputElement>('[aria-label="NCB 신용점수"]')!;
    await act(async () => setInput(ncb, "invalid"));
    await blur(ncb);
    expect(saveAction).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("1~1,000");
    expect(statuses.mock.calls.at(-1)).toEqual(["credit_score_ncb", "저장 확인 필요"]);

    await act(async () => setInput(ncb, "812"));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    act(() => {
      ncb.focus();
      ncb.blur();
      ncb.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(statuses).toHaveBeenCalledWith("credit_score_ncb", "저장 중…");
    await act(async () => { release({ ok: true, message: "저장됨" }); await Promise.resolve(); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(statuses.mock.calls.at(-1)).toEqual(["credit_score_ncb", "✓ 자동 저장됨"]);
  });
});
