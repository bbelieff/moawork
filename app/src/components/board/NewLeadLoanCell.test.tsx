// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/(app)/boards/new-lead-actions", () => ({
  saveNewLeadLoanProfileAction: actions.save,
}));

import { NewLeadLoanCell } from "./NewLeadLoanCell";
import {
  LOAN_RECORD_SYNC_LIMIT,
  clearLoanRecordSyncState,
  getLoanRecordSnapshot,
  loanRecordSyncEntryCount,
  publishLoanRecords,
} from "./new-lead-loan-sync";

type Loan = {
  id: string;
  provider: string;
  month: string;
  amount: number | null;
  rate: number | null;
  terms: string;
  notes: string;
};

const loan = (id: string, provider: string): Loan => ({
  id,
  provider,
  month: "2026-08",
  amount: 30_000_000,
  rate: 3.75,
  terms: "만기일시상환",
  notes: "보존할 긴 비고",
});
const values = (records: readonly Loan[]) => ({ existing_loan_records: JSON.stringify(records) });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function successfulResult(formData: FormData, records = JSON.parse(String(formData.get("loanRecords")))) {
  return {
    ok: true,
    message: "기대출 정보를 저장했습니다.",
    requestId: String(formData.get("requestId")),
    boardId: String(formData.get("boardId")),
    itemId: String(formData.get("itemId")),
    records,
  };
}

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(ui));
}

async function rerender(ui: ReactNode) {
  await act(async () => root?.render(ui));
}

async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function change(element: HTMLInputElement | HTMLTextAreaElement, next: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolveFrame) => window.requestAnimationFrame(() => resolveFrame(undefined)));
  });
}

function trigger(itemId = "item-a") {
  const result = document.querySelector<HTMLButtonElement>(`#loan-${itemId}`);
  if (!result) throw new Error("loan trigger not found");
  return result;
}

function cell(itemId: string, records: readonly Loan[] = [], labelled = true) {
  return (
    <NewLeadLoanCell
      boardId="board-a"
      itemId={itemId}
      values={values(records)}
      readOnly={false}
      controlId={labelled ? `loan-${itemId}` : undefined}
    />
  );
}

beforeEach(() => {
  actions.save.mockReset().mockImplementation(async (_state, formData: FormData) => successfulResult(formData));
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 0);
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  }
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container = null;
  document.body.replaceChildren();
  clearLoanRecordSyncState();
});

describe("Issue #591 기대출 편집기", () => {
  it("0건을 정확히 한 번 저장하고 닫힌 요약과 trigger focus를 즉시 갱신한다", async () => {
    await render(cell("item-a", [loan("loan-a", "기업은행")]));
    await click(trigger());
    await click(document.querySelector('section[aria-label="기대출 1"] button')!);
    const form = document.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(actions.save).toHaveBeenCalledTimes(1);
    const sent = actions.save.mock.calls[0][1] as FormData;
    expect(sent.get("loanRecords")).toBe("[]");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger().textContent).toBe("0건");
    expect(document.activeElement).toBe(trigger());
  });

  it("n건 성공은 서버 정규화 records만 publish하고 동일 board/item sibling만 동기화한다", async () => {
    actions.save.mockImplementation(async (_state, formData: FormData) => successfulResult(formData, [loan("normalized", "정규화은행")]));
    await render(<>{cell("item-a")}{cell("item-a", [], false)}{cell("item-b")}</>);
    expect(document.querySelectorAll("#loan-item-a")).toHaveLength(1);
    await click(document.querySelectorAll<HTMLButtonElement>("#loan-item-a")[0]);
    await click(document.querySelector<HTMLButtonElement>("footer > button")!);
    const provider = document.querySelector<HTMLInputElement>('input[placeholder="예: 기업은행"]')!;
    await change(provider, "클라이언트 추정값");
    await click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    await flush();

    const sameTarget = [...document.querySelectorAll<HTMLButtonElement>('[aria-label^="기대출 편집: 정규화은행"]')];
    expect(sameTarget.map((button) => button.textContent)).toEqual(["정규화은행 · 2026-08 · 30,000,000원 · 3.75%", "정규화은행 · 2026-08 · 30,000,000원 · 3.75%"]);
    expect(trigger("item-b").textContent).toBe("0건");
  });

  it("save 당시 닫혀 있던 sibling도 stale props로 늦게 mount하면 retained snapshot을 즉시 소비한다", async () => {
    actions.save.mockImplementation(async (_state, formData: FormData) => successfulResult(formData, [loan("normalized", "최신은행")]));
    await render(cell("item-a", [loan("old", "이전은행")]));
    await click(trigger());
    await click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    await flush();

    await rerender(<>{cell("item-a", [loan("old", "이전은행")])}{cell("item-a", [loan("old", "이전은행")], false)}</>);
    const summaries = [...document.querySelectorAll<HTMLButtonElement>('[aria-label^="기대출 편집: 최신은행"]')];
    expect(summaries).toHaveLength(2);
    expect(document.querySelectorAll("#loan-item-a")).toHaveLength(1);
    await click(trigger());
    expect(document.querySelector<HTMLInputElement>('input[placeholder="예: 기업은행"]')?.value).toBe("최신은행");
  });

  it("동일 key의 confirmed sibling 하나가 stale sibling의 retained 최신값을 effect flush 중 지우지 않는다", async () => {
    const current = loan("current", "최신은행");
    const stale = loan("stale", "이전은행");
    actions.save.mockImplementation(async (_state, formData: FormData) => successfulResult(formData, [current]));
    await render(cell("item-a", [stale]));
    await click(trigger());
    await click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    await flush();

    await rerender(<>{cell("item-a", [current])}{cell("item-a", [stale], false)}</>);
    await flush();
    expect([...document.querySelectorAll<HTMLButtonElement>('[aria-label^="기대출 편집:"]')].map((button) => button.textContent)).toEqual([
      "최신은행 · 2026-08 · 30,000,000원 · 3.75%",
      "최신은행 · 2026-08 · 30,000,000원 · 3.75%",
    ]);
    expect(getLoanRecordSnapshot({ boardId: "board-a", itemId: "item-a" })).not.toBeNull();

    await rerender(cell("item-a", [current]));
    await flush();
    expect(getLoanRecordSnapshot({ boardId: "board-a", itemId: "item-a" })).toBeNull();
  });

  it("confirmed 세대 뒤 과거 digest로의 authoritative revert를 mounted/late sibling 모두 수용한다", async () => {
    const before = loan("before", "이전은행");
    const saved = loan("saved", "저장은행");
    actions.save.mockImplementation(async (_state, formData: FormData) => successfulResult(formData, [saved]));
    await render(cell("item-a", [before]));
    await click(trigger());
    await click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    await flush();

    await rerender(cell("item-a", [saved]));
    await flush();
    expect(getLoanRecordSnapshot({ boardId: "board-a", itemId: "item-a" })).toBeNull();

    await rerender(<>{cell("item-a", [before])}{cell("item-a", [before], false)}</>);
    await flush();
    expect([...document.querySelectorAll<HTMLButtonElement>('[aria-label^="기대출 편집:"]')].map((button) => button.textContent)).toEqual([
      "이전은행 · 2026-08 · 30,000,000원 · 3.75%",
      "이전은행 · 2026-08 · 30,000,000원 · 3.75%",
    ]);
    expect(document.querySelectorAll("#loan-item-a")).toHaveLength(1);
  });

  it("late-mount snapshot cache는 미사용 key를 LRU 상한으로 정리한다", () => {
    for (let index = 0; index <= LOAN_RECORD_SYNC_LIMIT; index += 1) {
      publishLoanRecords(
        { boardId: "board-cache", itemId: `item-${index}` },
        [loan(`loan-${index}`, `은행${index}`)],
        [],
      );
    }
    expect(loanRecordSyncEntryCount()).toBe(LOAN_RECORD_SYNC_LIMIT);
    expect(getLoanRecordSnapshot({ boardId: "board-cache", itemId: "item-0" })).toBeNull();
    expect(getLoanRecordSnapshot({ boardId: "board-cache", itemId: `item-${LOAN_RECORD_SYNC_LIMIT}` })).not.toBeNull();
  });

  it("resolved failure와 transport rejection은 draft를 보존하고 동일 requestId로 재시도한다", async () => {
    actions.save
      .mockImplementationOnce(async (_state, formData: FormData) => ({ ...successfulResult(formData), ok: false, message: "권한 없음", records: [] }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(async (_state, formData: FormData) => successfulResult(formData, [loan("loan-a", "재시도은행")]));
    await render(cell("item-a", [loan("loan-a", "기업은행")]));
    await click(trigger());
    const provider = document.querySelector<HTMLInputElement>('input[placeholder="예: 기업은행"]')!;
    await change(provider, "재시도은행");
    const save = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    await click(save());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("권한 없음");
    expect(provider.value).toBe("재시도은행");
    await click(save());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("다시 시도");
    await click(save());
    await flush();

    const requestIds = actions.save.mock.calls.map((call) => (call[1] as FormData).get("requestId"));
    expect(new Set(requestIds).size).toBe(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("clean-open은 fresh props를 받고 dirty-open만 draft를 보존하며 취소 뒤 최신값으로 복원한다", async () => {
    await render(cell("item-a", [loan("loan-a", "기존은행")]));
    await rerender(cell("item-a", [loan("loan-a", "서버은행")]));
    expect(trigger().textContent).toContain("서버은행");
    await click(trigger());
    await rerender(cell("item-a", [loan("loan-a", "열린최신은행")]));
    expect(document.querySelector<HTMLInputElement>('input[placeholder="예: 기업은행"]')?.value).toBe("열린최신은행");
    const provider = document.querySelector<HTMLInputElement>('input[placeholder="예: 기업은행"]')!;
    await change(provider, "작성중은행");
    await rerender(cell("item-a", [loan("loan-a", "새서버은행")]));
    expect(document.querySelector<HTMLInputElement>('input[placeholder="예: 기업은행"]')?.value).toBe("작성중은행");
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "취소");
    await click(cancel!);
    await flush();
    await click(trigger());
    expect(document.querySelector<HTMLInputElement>('input[placeholder="예: 기업은행"]')?.value).toBe("새서버은행");
  });

  it("target swap 뒤 늦은 성공은 새 target을 닫거나 publish하지 않는다", async () => {
    let resolveSave!: (value: ReturnType<typeof successfulResult>) => void;
    actions.save.mockImplementationOnce((_state, formData: FormData) => new Promise((resolvePromise) => {
      resolveSave = (result) => resolvePromise(result);
      void formData;
    }));
    await render(cell("item-a", [loan("loan-a", "기존은행")]));
    await click(trigger());
    await click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    const sent = actions.save.mock.calls[0][1] as FormData;
    await rerender(cell("item-b"));
    await act(async () => resolveSave(successfulResult(sent, [loan("late", "늦은응답")])));
    expect(trigger("item-b").textContent).toBe("0건");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Escape/cancel은 저장하지 않고 20건 제한과 긴 notes를 보존한다", async () => {
    const twenty = Array.from({ length: 20 }, (_, index) => ({ ...loan(`loan-${index}`, `은행${index}`), notes: `긴 비고 ${"가".repeat(200)}` }));
    await render(cell("item-a", twenty));
    await click(trigger());
    expect(document.querySelectorAll("section[aria-label^='기대출 ']")).toHaveLength(20);
    expect(document.querySelector<HTMLButtonElement>("footer > button")?.disabled).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.rows).toBe(1);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await flush();
    expect(actions.save).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("outer는 overflow hidden이고 body만 안정된 thin scrollbar를 가진 4+2 grid다", () => {
    const css = readFileSync(resolve(import.meta.dirname, "NewLeadLoanCell.module.css"), "utf8");
    const declaredTokens = [
      readFileSync(resolve(import.meta.dirname, "../../styles/moawork-tokens.css"), "utf8"),
      readFileSync(resolve(import.meta.dirname, "../../app/globals.css"), "utf8"),
    ].join("\n");
    const referencedTokens = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
    expect(css).toMatch(/\.panel[\s\S]*overflow:\s*hidden/);
    expect(css).toMatch(/\.body[\s\S]*min-height:\s*0[\s\S]*overflow-y:\s*auto[\s\S]*scrollbar-gutter:\s*stable/);
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toMatch(/\.terms, \.notes \{ grid-column: span 2; \}/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    for (const token of referencedTokens) expect(declaredTokens).toContain(`${token}:`);
  });
});
