/**
 * 연도별 전체 원장 — 집계 순수 로직 (BBE-240 목업 ③).
 *
 * org 전체 deal_ledger_entries 를 발생일(occurredOn) 기준 연도 → 월로 묶는다.
 * 매출 인식은 항상 금액(공급가, amount) 기준 — 부가세 포함 입금액이 있어도
 * 합계에는 안 들어간다(DealLedgerPanel/원장 입력 폼과 동일 원칙, BBE-240).
 */

import type { LedgerKind } from "./ledger";

export interface YearlyLedgerRow {
  id: string;
  dealId: string;
  dealTitle: string;
  assigneeName: string | null;
  kind: LedgerKind;
  amount: number;
  receivedAmount: number;
  occurredOn: string; // "yyyy-mm-dd"
  paidOn: string | null;
}

export interface YearlyLedgerMonthGroup {
  /** "yyyy-mm" */
  month: string;
  rows: readonly YearlyLedgerRow[];
}

export interface YearlyLedgerYearTotals {
  totalRevenue: number;
  depositTotal: number;
  feeTotal: number;
  outstandingTotal: number;
}

export interface YearlyLedgerYearGroup {
  /** "yyyy" */
  year: string;
  totals: YearlyLedgerYearTotals;
  months: readonly YearlyLedgerMonthGroup[];
}

function yearOf(occurredOn: string): string {
  return occurredOn.slice(0, 4);
}

function monthOf(occurredOn: string): string {
  return occurredOn.slice(0, 7);
}

function totalsOf(rows: readonly YearlyLedgerRow[]): YearlyLedgerYearTotals {
  let totalRevenue = 0;
  let depositTotal = 0;
  let feeTotal = 0;
  let outstandingTotal = 0;
  for (const row of rows) {
    totalRevenue += row.amount;
    if (row.kind === "contract_deposit") depositTotal += row.amount;
    else feeTotal += row.amount;
    outstandingTotal += Math.max(0, row.amount - row.receivedAmount);
  }
  return { totalRevenue, depositTotal, feeTotal, outstandingTotal };
}

/** 발생일 기준 연도 → 월 그룹. 연도는 오름차순, 월도 오름차순, 월 안 항목은 발생일 오름차순. */
export function groupYearlyLedger(rows: readonly YearlyLedgerRow[]): readonly YearlyLedgerYearGroup[] {
  const byYear = new Map<string, YearlyLedgerRow[]>();
  for (const row of rows) {
    const year = yearOf(row.occurredOn);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(row);
    else byYear.set(year, [row]);
  }

  return Array.from(byYear.keys())
    .sort()
    .map((year) => {
      const yearRows = [...(byYear.get(year) ?? [])].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
      const byMonth = new Map<string, YearlyLedgerRow[]>();
      for (const row of yearRows) {
        const month = monthOf(row.occurredOn);
        const bucket = byMonth.get(month);
        if (bucket) bucket.push(row);
        else byMonth.set(month, [row]);
      }
      const months = Array.from(byMonth.keys())
        .sort()
        .map((month) => ({ month, rows: byMonth.get(month) ?? [] }));
      return { year, totals: totalsOf(yearRows), months };
    });
}
