import type { DealLedgerEntry } from "@/lib/accounting";
import { entryOutstanding } from "@/lib/accounting/ledger";
import {
  LEDGER_KIND_LABEL,
  ledgerProductLabel,
  UNASSIGNED_LABEL,
  type LedgerReportRow,
} from "@/lib/accounting/report";

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
    content: csv(HEADER, body),
    rowCount: rows.length,
  };
}

/** BOM \uC740 \uC5D1\uC140\uC774 UTF-8 \uB85C \uC5F4\uAC8C \uD558\uB294 \uC720\uC77C\uD55C \uC2E0\uD638\uB2E4 \u2014 \uBE7C\uBA74 \uD55C\uAE00\uC774 \uC804\uBD80 \uAE68\uC9C4\uB2E4. */
function csv(header: readonly string[], body: readonly string[]): string {
  return `\uFEFF${header.map(safeSpreadsheetCell).join(",")}\r\n${body.join("\r\n")}${body.length ? "\r\n" : ""}`;
}

/**
 * \uC815\uC0B0 \uB9AC\uD3EC\uD2B8 CSV \uC758 \uC5F4 \u2014 \uD654\uBA74 \uB9AC\uD3EC\uD2B8(\uC815\uBCF8)\uC640 \uAC19\uC740 11\uAC1C.
 *
 * \uC704 `createLedgerCsvExport` \uC640 \uC5F4\uC774 \uB2E4\uB974\uB2E4. \uADF8\uCABD\uC740 \uC5C5\uBB34 ID\u00B7\uC6D0\uC7A5 ID \uB97C \uC2E4\uC740 \u00AB\uB0B4\uBD80 \uC2DD\uBCC4\uC790\u00BB
 * \uD310\uC774\uACE0, \uB9AC\uD3EC\uD2B8\uB294 \uCD1D\uAD04 \uC2B9\uC778\uB300\uB85C \uC721\uD558\uC6D0\uCE59 \uC5F4\uB9CC \uC2E3\uB294\uB2E4(\uB0B4\uBD80 ID \uC5C6\uC74C). \uB450 \uBC8C\uC744 \uB9CC\uB4E0 \uAC8C \uC544\uB2C8\uB77C
 * \uAC19\uC740 \uD30C\uC77C\uC5D0\uC11C BOM\u00B7\uC218\uC2DD \uBC29\uC5B4(safeSpreadsheetCell)\u00B7\uC904\uBC14\uAFC8 \uADDC\uC57D\uC744 \uACF5\uC720\uD55C\uB2E4.
 */
export const LEDGER_REPORT_CSV_HEADER = [
  "\uC5C5\uCCB4",
  "\uB2F4\uB2F9\uC790",
  "\uC9C4\uD589\uAE30\uAD00",
  "\uC0C1\uD488\uBA85\uCE6D(\uC138\uBD80\uBA85\uCE6D)",
  // \u2605 \u300C\uAD6C\uBD84\u300D \uC774 \uC544\uB2C8\uB2E4 \u2014 \uACC4\uC57D\uC5C5\uCCB4 \uC2E4\uBB34 \uBCF4\uB4DC\uC5D0 \uB2E4\uB978 \uB73B\uC758 \u00AB\uAD6C\uBD84\u00BB \uCEEC\uB7FC\uC774 \uC788\uB2E4(\uC790\uAE08/\uC9C0\uC6D0\uAE08/\u2026).
  "\uC218\uB0A9\uAD6C\uBD84",
  "\uBC1C\uC0DD\uC77C",
  "\uC785\uAE08\uC77C",
  "\uAE08\uC561(\uACF5\uAE09\uAC00)",
  "\uC785\uAE08\uC561",
  "\uBBF8\uC218\uAE08",
  "\uACC4\uC0B0\uC11C",
] as const;

/**
 * \uC774\uBBF8 \u00AB\uD544\uD130\uAC00 \uB05D\uB09C\u00BB \uD589\uC744 \uD654\uBA74 \uC21C\uC11C \uADF8\uB300\uB85C \uBC1B\uB294\uB2E4 \u2014 \uD654\uBA74\uC774 \uC815\uBCF8\uC774\uBBC0\uB85C CSV \uAC00 \uC870\uAC74\uC744 \uB2E4\uC2DC
 * \uD574\uC11D\uD558\uBA74 \uB450 \uC218\uAC00 \uAC08\uB77C\uC9C8 \uC218 \uC788\uB2E4. period \uB294 \uD30C\uC77C\uBA85\uC5D0\uB9CC \uC4F4\uB2E4("" \uBA74 \uADF8 \uBC29\uD5A5\uC73C\uB85C \uC5F4\uB824 \uC788\uB2E4).
 *
 * \uC18C\uACC4\u00B7\uD569\uACC4 \uC904\uC740 \uB123\uC9C0 \uC54A\uB294\uB2E4. \uC2DC\uC548 \u00A7\u2461 \uBE44\uAD50\uD45C\uAC00 CSV \uB97C \u300C\uC5D1\uC140\uB85C \uC5F4\uC5B4 \uD53C\uBC97\u00B7\uC815\uB82C\u300D \uD558\uB294 \uC6A9\uB3C4\uB85C
 * \uBABB \uBC15\uC558\uACE0 \uC18C\uACC4 \uC904\uC774 \uC11E\uC774\uBA74 \uADF8 \uC815\uB82C\uC774 \uAE68\uC9C4\uB2E4 \u2014 \uC18C\uACC4\u00B7\uD569\uACC4\uB294 \uD654\uBA74\uACFC \uC778\uC1C4(PDF)\uC758 \uBAAB\uC774\uB2E4.
 */
export function createLedgerReportCsvExport(
  rows: readonly LedgerReportRow[],
  period: LedgerExportPeriod,
): LedgerCsvExport {
  const from = period.from ? requireDate(period.from, "from") : "";
  const to = period.to ? requireDate(period.to, "to") : "";
  if (from && to && from > to) throw new RangeError("from must not be after to");

  const body = rows.map((row) => [
    row.companyName,
    row.assigneeName ?? UNASSIGNED_LABEL,
    row.institution,
    ledgerProductLabel(row),
    LEDGER_KIND_LABEL[row.kind],
    row.occurredOn,
    row.paidOn,
    row.amount,
    row.receivedAmount,
    entryOutstanding(row),
    row.taxInvoiceIssued ? "\uBC1C\uD589" : "",
  ].map(safeSpreadsheetCell).join(","));

  const span = from || to ? `${from || "\uCC98\uC74C"}_${to || "\uC624\uB298"}` : "\uC804\uCCB4";
  return {
    filename: `\uC815\uC0B0\uB9AC\uD3EC\uD2B8_${span}.csv`,
    content: csv(LEDGER_REPORT_CSV_HEADER, body),
    rowCount: rows.length,
  };
}
