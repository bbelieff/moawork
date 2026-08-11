import type { DealLedgerEntry } from "@/lib/accounting";

export type LedgerExportPeriod = Readonly<{
  from: string;
  to: string;
}>;

export type LedgerCsvExport = Readonly<{
  filename: string;
  content: string;
  rowCount: number;
}>;

const HEADER = [
  "업무 ID",
  "원장 ID",
  "구분",
  "발생일",
  "귀속월",
  "금액",
  "입금액",
  "미수금",
  "입금일",
] as const;

const KIND_LABEL: Readonly<Record<DealLedgerEntry["kind"], string>> = {
  contract_deposit: "계약금",
  fee: "수수료",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORMULA = /^[\t\r\n ]*[=+\-@]/;

function requireDate(value: string, field: string): string {
  if (!DATE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new TypeError(`${field} must be an ISO date`);
  }
  return value;
}

/** Keeps spreadsheet applications from evaluating user-controlled cell text. */
export function safeSpreadsheetCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const safe = FORMULA.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function withinPeriod(entry: DealLedgerEntry, period: LedgerExportPeriod): boolean {
  return entry.occurredOn >= period.from && entry.occurredOn <= period.to;
}

/**
 * Builds a deterministic, Excel-readable CSV from canonical ledger rows.
 * The date range is inclusive and applies to the ledger occurrence date.
 */
export function createLedgerCsvExport(
  entries: readonly DealLedgerEntry[],
  period: LedgerExportPeriod,
): LedgerCsvExport {
  const from = requireDate(period.from, "from");
  const to = requireDate(period.to, "to");
  if (from > to) throw new RangeError("from must not be after to");

  const rows = entries
    .filter((entry) => {
      requireDate(entry.occurredOn, "occurredOn");
      requireDate(entry.attributionMonth, "attributionMonth");
      if (entry.paidOn !== null) requireDate(entry.paidOn, "paidOn");
      return withinPeriod(entry, { from, to });
    })
    .slice()
    .sort((left, right) =>
      left.occurredOn.localeCompare(right.occurredOn) || left.id.localeCompare(right.id),
    );

  const body = rows.map((entry) => [
    entry.dealId,
    entry.id,
    KIND_LABEL[entry.kind],
    entry.occurredOn,
    entry.attributionMonth,
    entry.amount,
    entry.receivedAmount,
    entry.amount - entry.receivedAmount,
    entry.paidOn,
  ].map(safeSpreadsheetCell).join(","));

  return {
    filename: `업무원장_${from}_${to}.csv`,
    content: `\uFEFF${HEADER.map(safeSpreadsheetCell).join(",")}\r\n${body.join("\r\n")}${body.length ? "\r\n" : ""}`,
    rowCount: rows.length,
  };
}
