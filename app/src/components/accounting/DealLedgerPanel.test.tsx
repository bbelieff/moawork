import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DealLedgerPanel } from "./DealLedgerPanel";

const entries = [
  { id: "deposit-1", dealId: "deal-1", kind: "contract_deposit" as const, amount: 100_000, receivedAmount: 100_000, occurredOn: "2026-08-01", paidOn: "2026-08-01", attributionMonth: "2026-08-01", vatIncluded: false, taxInvoiceIssued: false },
  { id: "fee-1", dealId: "deal-1", kind: "fee" as const, amount: 50_000, receivedAmount: 20_000, occurredOn: "2026-08-02", paidOn: null, attributionMonth: "2026-08-01", vatIncluded: false, taxInvoiceIssued: false },
];

describe("DealLedgerPanel", () => {
  it("renders ledger rows, equal fee totals, and outstanding money from the canonical model", () => {
    const html = renderToStaticMarkup(<DealLedgerPanel dealId="deal-1" state={{ kind: "ready", entries, expectedFeeTotal: 50_000 }} />);
    expect(html).toContain("업무 원장");
    expect(html).toContain("계약금");
    expect(html).toContain("수수료");
    expect(html).toContain("50,000원");
    expect(html).toContain("30,000원");
    expect(html).toContain("아직 입금되지 않았어요");
  });

  it("does not show mismatched fee totals as valid", () => {
    const html = renderToStaticMarkup(<DealLedgerPanel dealId="deal-1" state={{ kind: "ready", entries, expectedFeeTotal: 49_999 }} />);
    expect(html).toContain("수수료 합계와 원장 합계가 맞지 않아 보여줄 수 없어요");
    expect(html).not.toContain("50,000원");
  });

  it("shows a VAT badge only for VAT-included rows, and clamps outstanding money at zero", () => {
    const vatEntries = [
      { id: "vat-1", dealId: "deal-1", kind: "fee" as const, amount: 100_000, receivedAmount: 110_000, occurredOn: "2026-08-03", paidOn: "2026-08-03", attributionMonth: "2026-08-01", vatIncluded: true, taxInvoiceIssued: true },
    ];
    const html = renderToStaticMarkup(<DealLedgerPanel dealId="deal-1" state={{ kind: "ready", entries: vatEntries, expectedFeeTotal: 100_000 }} />);
    expect(html).toContain("VAT포함 전액 입금");
    expect(html).toContain("계산서 발행✓");
    expect(html).toContain("0원"); // 미수금이 음수(-10,000)로 새지 않고 0으로 잡힌다.
  });

  it("has truthful nonblank empty and unavailable states", () => {
    const empty = renderToStaticMarkup(<DealLedgerPanel dealId="deal-1" state={{ kind: "ready", entries: [], expectedFeeTotal: 0 }} />);
    const unavailable = renderToStaticMarkup(<DealLedgerPanel dealId="deal-1" state={{ kind: "error" }} />);
    expect(empty).toContain("아직 원장 항목이 없어요");
    expect(unavailable).toContain("원장을 불러오지 못했어요");
  });
});
