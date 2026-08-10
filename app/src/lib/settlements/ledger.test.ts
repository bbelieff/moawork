import { describe, expect, it } from "vitest";
import { assertWon, calculateTotals, correctionPair, toMinimalCsv, type LedgerEntry } from "./ledger";

const entry = (patch: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: "entry-1", settlementId: "settlement-1", kind: "payment", amount: 300,
  occurredOn: "2026-08-10", source: "input", status: "posted", correctedFrom: null,
  createdAt: "2026-08-10T00:00:00Z", createdBy: "user-1", ...patch,
});

describe("settlement ledger", () => {
  it("부분입금·환불·취소를 반영해 합계를 다시 계산한다", () => {
    const totals = calculateTotals(1_000, [entry(), entry({ id: "e2", amount: 200 }), entry({ id: "e3", kind: "refund", amount: 50 }), entry({ id: "e4", amount: 900, status: "canceled" })]);
    expect(totals).toEqual({ expected: 1_000, paid: 450, outstanding: 550, paymentCount: 2, status: "partial" });
  });

  it("완납과 초과입금을 구분한다", () => {
    expect(calculateTotals(300, [entry()]).status).toBe("paid");
    expect(calculateTotals(200, [entry()]).status).toBe("overpaid");
  });

  it("정정은 원본 취소와 새 행 추가로 남겨 이력을 덮어쓰지 않는다", () => {
    const [oldRow, newRow] = correctionPair(entry(), { id: "entry-2", amount: 350, occurredOn: "2026-08-11", createdAt: "2026-08-11T00:00:00Z", createdBy: "user-2" });
    expect(oldRow.status).toBe("canceled");
    expect(newRow.correctedFrom).toBe("entry-1");
    expect(newRow.amount).toBe(350);
  });

  it("CSV는 고객정보·메모·사용자 식별자 없이 최소 열만 제공한다", () => {
    const csv = toMinimalCsv([{ settlementId: "s-1", expected: 1_000, totals: calculateTotals(1_000, [entry()]) }]);
    expect(csv).toContain("정산ID");
    expect(csv).not.toMatch(/고객|연락처|메모|user-1/);
  });

  it("원 단위 양의 정수만 받는다", () => {
    expect(assertWon("10")).toBe(10);
    expect(() => assertWon(0)).toThrow("1원 이상의 정수");
    expect(() => assertWon(1.5)).toThrow("1원 이상의 정수");
  });
});
