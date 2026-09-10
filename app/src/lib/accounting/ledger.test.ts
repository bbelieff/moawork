import { describe, expect, it } from "vitest";
import {
  assertFeeLedgerTotal,
  canonicalLedgerKind,
  legacyLedgerKind,
  summarizeDealLedger,
  type DealLedgerEntry,
} from "./ledger";

function entry(
  id: string,
  patch: Partial<DealLedgerEntry> = {},
): DealLedgerEntry {
  return {
    id,
    dealId: "deal-1",
    kind: "fee",
    amount: 100,
    receivedAmount: 0,
    occurredOn: "2026-08-11",
    paidOn: null,
    attributionMonth: "2026-08-01",
    vatIncluded: false,
    taxInvoiceIssued: false,
    ...patch,
  };
}

describe("deal ledger", () => {
  it("keeps stable ledger IDs separate from legacy stored aliases", () => {
    expect(canonicalLedgerKind("fee")).toBe("ledger.fee");
    expect(legacyLedgerKind("ledger.contract_deposit")).toBe("contract_deposit");
    expect(canonicalLedgerKind("unknown")).toBeUndefined();
  });
  it("attaches many ledger entries to one deal without copying the deal", () => {
    const entries = [
      entry("deposit", { kind: "contract_deposit", amount: 1_000, receivedAmount: 1_000 }),
      entry("fee-1", { amount: 300, receivedAmount: 100 }),
      entry("fee-2", { amount: 200, receivedAmount: 0 }),
    ];

    expect(new Set(entries.map((item) => item.dealId))).toEqual(new Set(["deal-1"]));
    expect(summarizeDealLedger("deal-1", entries)).toEqual({
      dealId: "deal-1",
      entryCount: 3,
      ledgerTotal: 1_500,
      feeTotal: 500,
      receivedTotal: 1_100,
      outstandingTotal: 400,
    });
  });

  it("requires the expected fee to equal the fee ledger sum", () => {
    const summary = summarizeDealLedger("deal-1", [
      entry("fee-1", { amount: 300 }),
      entry("fee-2", { amount: 200 }),
    ]);
    expect(() => assertFeeLedgerTotal(500, summary)).not.toThrow();
    expect(() => assertFeeLedgerTotal(499, summary)).toThrow(
      "fee total must equal the fee ledger total",
    );
  });

  it("removing a ledger entry changes only the derived total", () => {
    const entries = [entry("fee-1", { amount: 300 }), entry("fee-2", { amount: 200 })];
    const remaining = entries.filter((item) => item.id !== "fee-1");
    expect(summarizeDealLedger("deal-1", remaining).ledgerTotal).toBe(200);
    expect(remaining.every((item) => item.dealId === "deal-1")).toBe(true);
  });

  it("rejects overpayment instead of producing a negative receivable", () => {
    expect(() =>
      summarizeDealLedger("deal-1", [entry("fee", { amount: 100, receivedAmount: 101 })]),
    ).toThrow("receivedAmount cannot exceed amount");
  });

  it("allows a VAT-included entry's received amount to exceed the supply amount", () => {
    expect(() =>
      summarizeDealLedger("deal-1", [
        entry("fee", { amount: 100, receivedAmount: 110, vatIncluded: true }),
      ]),
    ).not.toThrow();
  });

  it("does not let a VAT-overpaid entry mask another entry's real outstanding balance", () => {
    const summary = summarizeDealLedger("deal-1", [
      entry("vat", { amount: 100, receivedAmount: 110, vatIncluded: true }),
      entry("unpaid", { amount: 50, receivedAmount: 0 }),
    ]);
    // 순합계(150-110=40)였다면 50 미수가 가려진다 — entry 단위 합만 정답이다.
    expect(summary.outstandingTotal).toBe(50);
  });
});
