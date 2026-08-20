import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
});
