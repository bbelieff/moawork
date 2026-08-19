import { describe, expect, it } from "vitest";
import { isSettlementClosed } from "./DealLedgerButton";
import type { DealLedgerEntry } from "@/lib/accounting/ledger";
import type { LedgerPopupState } from "@/lib/accounting/actions";

function entry(over: Partial<DealLedgerEntry>): DealLedgerEntry {
  return {
    id: "e1",
    dealId: "deal-1",
    kind: "contract_deposit",
    amount: 1_000_000,
    receivedAmount: 1_000_000,
    occurredOn: "2026-03-05",
    paidOn: "2026-03-05",
    attributionMonth: "2026-03-01",
    vatIncluded: false,
    taxInvoiceIssued: false,
    ...over,
  };
}

function ready(entries: DealLedgerEntry[], feeTerms: string | null = null): LedgerPopupState {
  return { kind: "ready", entries, expectedFeeTotal: 0, feeTerms };
}

describe("BBE-240 · isSettlementClosed — 수납종료 뱃지 판정", () => {
  it("계약금·수수료 둘 다 완납이면 수납종료다", () => {
    const state = ready([
      entry({ id: "d", kind: "contract_deposit", amount: 1_000_000, receivedAmount: 1_000_000 }),
      entry({ id: "f", kind: "fee", amount: 5_000_000, receivedAmount: 5_000_000 }),
    ]);
    expect(isSettlementClosed(state)).toBe(true);
  });

  it("수수료가 미수인 채로 남아 있으면 수납종료가 아니다", () => {
    const state = ready([
      entry({ id: "d", kind: "contract_deposit", amount: 1_000_000, receivedAmount: 1_000_000 }),
      entry({ id: "f", kind: "fee", amount: 5_000_000, receivedAmount: 4_000_000 }),
    ]);
    expect(isSettlementClosed(state)).toBe(false);
  });

  it("계약금만 있고 수수료가 아예 없으면 수납종료가 아니다(둘 다 있어야 한다)", () => {
    const state = ready([entry({ id: "d", kind: "contract_deposit", amount: 1_000_000, receivedAmount: 1_000_000 })]);
    expect(isSettlementClosed(state)).toBe(false);
  });

  it("아직 아무 항목도 없으면(빈 원장) 수납종료가 아니다", () => {
    expect(isSettlementClosed(ready([]))).toBe(false);
  });

  it("부가세 포함이라 입금액이 금액을 넘어도(완납 그 이상) 수납종료로 본다", () => {
    const state = ready([
      entry({ id: "d", kind: "contract_deposit", amount: 1_000_000, receivedAmount: 1_000_000 }),
      entry({ id: "f", kind: "fee", amount: 5_000_000, receivedAmount: 5_500_000, vatIncluded: true, taxInvoiceIssued: true }),
    ]);
    expect(isSettlementClosed(state)).toBe(true);
  });

  it("로딩·오류 상태에서는 수납종료로 표시하지 않는다", () => {
    expect(isSettlementClosed({ kind: "loading" })).toBe(false);
    expect(isSettlementClosed({ kind: "error" })).toBe(false);
  });
});
