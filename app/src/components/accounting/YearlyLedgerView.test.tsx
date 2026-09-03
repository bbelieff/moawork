// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { YearlyLedgerView } from "./YearlyLedgerView";
import { groupYearlyLedger, type YearlyLedgerRow } from "@/lib/accounting/yearly";

function row(partial: Partial<YearlyLedgerRow> & Pick<YearlyLedgerRow, "id" | "occurredOn" | "kind" | "amount">): YearlyLedgerRow {
  return {
    dealId: "deal-1",
    dealTitle: "㈜예시상사",
    assigneeName: "박정화",
    receivedAmount: partial.amount,
    paidOn: partial.occurredOn,
    ...partial,
  };
}

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function renderFixture(rows: readonly YearlyLedgerRow[]) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<YearlyLedgerView groups={groupYearlyLedger(rows)} />));
  return host;
}

async function press(element: HTMLElement, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("YearlyLedgerView", () => {
  it("빈 데이터면 안내문만 보여준다(거짓 빈 화면 아님)", () => {
    const html = renderToStaticMarkup(<YearlyLedgerView groups={[]} />);
    expect(html).toContain("아직 원장 항목이 없어요");
  });

  it("가장 최근 연도가 기본 선택되고, 그 해의 합계·월별 표가 보인다", () => {
    const groups = groupYearlyLedger([
      row({ id: "old", occurredOn: "2024-09-11", kind: "contract_deposit", amount: 800_000 }),
      row({ id: "new-deposit", occurredOn: "2026-03-05", kind: "contract_deposit", amount: 1_000_000 }),
      row({ id: "new-fee", occurredOn: "2026-05-20", kind: "fee", amount: 5_000_000 }),
    ]);
    const html = renderToStaticMarkup(<YearlyLedgerView groups={groups} />);
    expect(html).toContain("2024년");
    expect(html).toContain("2026년");
    expect(html).toContain("6,000,000원"); // 2026년 총매출액(기본 선택) — 2024년 합계가 아님.
    expect(html).toContain("2026년 3월");
    expect(html).toContain("2026년 5월");
    expect(html).toContain("㈜예시상사");
    expect(html).toContain("박정화");
    // 기본 선택되지 않은 2024년의 월 그룹까지 한 화면에 다 뿌리진 않는다.
    expect(html).not.toContain("2024년 9월");
  });

  it("담당자가 없으면 대시로 보여준다(빈 문자열 아님)", () => {
    const groups = groupYearlyLedger([
      row({ id: "a", occurredOn: "2026-01-05", kind: "fee", amount: 1, assigneeName: null, paidOn: null }),
    ]);
    const html = renderToStaticMarkup(<YearlyLedgerView groups={groups} />);
    expect(html).toContain("<td>-</td>");
  });

  it("connects each year tab to a stable panel and exposes only the selected year as a tab stop", async () => {
    const host = await renderFixture([
      row({ id: "2024", occurredOn: "2024-01-01", kind: "fee", amount: 1 }),
      row({ id: "2025", occurredOn: "2025-01-01", kind: "fee", amount: 2 }),
      row({ id: "2026", occurredOn: "2026-01-01", kind: "fee", amount: 3 }),
    ]);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => [tab.id, tab.getAttribute("aria-controls"), tab.tabIndex])).toEqual([
      ["ledger-year-tab-2024", "ledger-year-panel-2024", -1],
      ["ledger-year-tab-2025", "ledger-year-panel-2025", -1],
      ["ledger-year-tab-2026", "ledger-year-panel-2026", 0],
    ]);
    expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(3);
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.id).toBe("ledger-year-panel-2026");
  });

  it("wraps year selection with arrows and supports Home, End, and click", async () => {
    const host = await renderFixture([
      row({ id: "2024", occurredOn: "2024-01-01", kind: "fee", amount: 1 }),
      row({ id: "2025", occurredOn: "2025-01-01", kind: "fee", amount: 2 }),
      row({ id: "2026", occurredOn: "2026-01-01", kind: "fee", amount: 3 }),
    ]);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[2].focus();

    await press(tabs[2], "ArrowRight");
    expect(document.activeElement).toBe(tabs[0]);
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.id).toBe("ledger-year-panel-2024");
    await press(tabs[0], "End");
    expect(document.activeElement).toBe(tabs[2]);
    await press(tabs[2], "Home");
    expect(document.activeElement).toBe(tabs[0]);
    await press(tabs[0], "ArrowLeft");
    expect(document.activeElement).toBe(tabs[2]);

    await act(async () => tabs[1].click());
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([tabs[1]]);
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.getAttribute("aria-labelledby")).toBe("ledger-year-tab-2025");
  });
});
