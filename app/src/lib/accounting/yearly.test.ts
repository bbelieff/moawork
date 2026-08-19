import { describe, expect, it } from "vitest";
import { groupYearlyLedger, type YearlyLedgerRow } from "./yearly";

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

describe("groupYearlyLedger", () => {
  it("연도 → 월 순으로(오름차순) 묶는다", () => {
    const groups = groupYearlyLedger([
      row({ id: "a", occurredOn: "2026-05-20", kind: "fee", amount: 5_000_000 }),
      row({ id: "b", occurredOn: "2024-09-11", kind: "contract_deposit", amount: 800_000 }),
      row({ id: "c", occurredOn: "2026-03-05", kind: "contract_deposit", amount: 1_000_000 }),
    ]);
    expect(groups.map((g) => g.year)).toEqual(["2024", "2026"]);
    const y2026 = groups.find((g) => g.year === "2026")!;
    expect(y2026.months.map((m) => m.month)).toEqual(["2026-03", "2026-05"]);
  });

  it("한 달 안 항목은 발생일 오름차순", () => {
    const groups = groupYearlyLedger([
      row({ id: "later", occurredOn: "2026-05-20", kind: "fee", amount: 1 }),
      row({ id: "earlier", occurredOn: "2026-05-02", kind: "contract_deposit", amount: 1 }),
    ]);
    const [month] = groups[0].months;
    expect(month.rows.map((r) => r.id)).toEqual(["earlier", "later"]);
  });

  it("총매출액=계약금+수수료, 각 합계는 구분별로 분리한다", () => {
    const groups = groupYearlyLedger([
      row({ id: "a", occurredOn: "2026-03-05", kind: "contract_deposit", amount: 1_000_000 }),
      row({ id: "b", occurredOn: "2026-05-20", kind: "fee", amount: 5_000_000 }),
    ]);
    expect(groups[0].totals).toMatchObject({
      totalRevenue: 6_000_000,
      depositTotal: 1_000_000,
      feeTotal: 5_000_000,
      outstandingTotal: 0,
    });
  });

  it("미수금은 entry 단위 max(0, amount-received) 를 합산한다 — 순합계 아님", () => {
    const groups = groupYearlyLedger([
      // 부가세 초과입금 entry(받은 돈이 더 많음)가 다른 entry 의 진짜 미수금을 가리면 안 된다.
      row({ id: "overpaid", occurredOn: "2026-05-20", kind: "fee", amount: 5_000_000, receivedAmount: 5_500_000 }),
      row({ id: "partial", occurredOn: "2026-06-01", kind: "fee", amount: 3_000_000, receivedAmount: 1_000_000 }),
    ]);
    // 순합계로 잘못 계산하면 (5.5M+1M) - (5M+3M) = -1.5M → max(0,...) 로 0 이 돼서
    // partial 의 진짜 미수금(2M)이 사라진다. entry 단위 합산이면 0 + 2,000,000 = 2,000,000.
    expect(groups[0].totals.outstandingTotal).toBe(2_000_000);
  });

  it("빈 입력이면 빈 배열", () => {
    expect(groupYearlyLedger([])).toEqual([]);
  });
});
