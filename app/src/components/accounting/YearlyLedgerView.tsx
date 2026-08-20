"use client";

import { useState } from "react";
import type { YearlyLedgerYearGroup } from "@/lib/accounting/yearly";
import styles from "./accounting.module.css";

export interface YearlyLedgerViewProps {
  groups: readonly YearlyLedgerYearGroup[];
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  contract_deposit: "계약금",
  fee: "수수료",
};

function won(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${y}년 ${Number(m)}월`;
}

export function YearlyLedgerView({ groups }: YearlyLedgerViewProps) {
  const [selectedYear, setSelectedYear] = useState<string | null>(groups.at(-1)?.year ?? null);

  if (groups.length === 0) {
    return (
      <section aria-label="연도별 원장" className={styles.notice}>
        아직 원장 항목이 없어요. 계약금이나 수수료가 기록되면 여기에 연도·월별로 보여요.
      </section>
    );
  }

  const active = groups.find((g) => g.year === selectedYear) ?? groups[groups.length - 1];

  return (
    <section aria-labelledby="yearly-ledger-title">
      <div className={styles.yearHead}>
        <h1 id="yearly-ledger-title">연도별 원장</h1>
        <div className={styles.yearTabs} role="tablist" aria-label="연도 선택">
          {groups.map((g) => (
            <button
              key={g.year}
              type="button"
              role="tab"
              aria-selected={g.year === active.year}
              onClick={() => setSelectedYear(g.year)}
            >
              {g.year}년
            </button>
          ))}
        </div>
      </div>

      <dl className={styles.summary}>
        <div><dt>총매출액</dt><dd>{won(active.totals.totalRevenue)}</dd></div>
        <div><dt>계약금 합계</dt><dd>{won(active.totals.depositTotal)}</dd></div>
        <div><dt>수수료 합계</dt><dd>{won(active.totals.feeTotal)}</dd></div>
        <div><dt>미수금</dt><dd>{won(active.totals.outstandingTotal)}</dd></div>
      </dl>

      {active.months.map((group) => (
        <div key={group.month} className={styles.monthGroup}>
          <h2>{monthLabel(group.month)}</h2>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>자금건</th>
                  <th>구분</th>
                  <th>금액</th>
                  <th>입금일</th>
                  <th>담당자</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.dealTitle}</td>
                    <td>{KIND_LABEL[row.kind]}</td>
                    <td>{won(row.amount)}</td>
                    <td>{row.paidOn ?? "-"}</td>
                    <td>{row.assigneeName ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
