"use client";

import { useRef, useState, type KeyboardEvent } from "react";
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

const yearTabId = (year: string) => `ledger-year-tab-${year}`;
const yearPanelId = (year: string) => `ledger-year-panel-${year}`;

export function YearlyLedgerView({ groups }: YearlyLedgerViewProps) {
  const [selectedYear, setSelectedYear] = useState<string | null>(groups.at(-1)?.year ?? null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (groups.length === 0) {
    return (
      <section aria-label="연도별 원장" className={styles.notice}>
        아직 원장 항목이 없어요. 계약금이나 수수료가 기록되면 여기에 연도·월별로 보여요.
      </section>
    );
  }

  const active = groups.find((g) => g.year === selectedYear) ?? groups[groups.length - 1];

  function selectYear(index: number, focus = false) {
    const next = groups[index];
    if (!next) return;
    setSelectedYear(next.year);
    if (focus) tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % groups.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + groups.length) % groups.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = groups.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectYear(nextIndex, true);
  }

  return (
    <section aria-labelledby="yearly-ledger-title">
      <div className={styles.yearHead}>
        <h1 id="yearly-ledger-title">연도별 원장</h1>
        <div className={styles.yearTabs} role="tablist" aria-label="연도 선택">
          {groups.map((g, index) => (
            <button
              key={g.year}
              ref={(node) => { tabRefs.current[index] = node; }}
              id={yearTabId(g.year)}
              type="button"
              role="tab"
              aria-controls={yearPanelId(g.year)}
              aria-selected={g.year === active.year}
              tabIndex={g.year === active.year ? 0 : -1}
              onClick={() => selectYear(index)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {g.year}년
            </button>
          ))}
        </div>
      </div>

      {groups.map((group) => (
        <div
          key={group.year}
          id={yearPanelId(group.year)}
          role="tabpanel"
          aria-labelledby={yearTabId(group.year)}
          hidden={group.year !== active.year}
        >
          {group.year === active.year ? (
            <>
              <dl className={styles.summary}>
                <div><dt>총매출액</dt><dd>{won(group.totals.totalRevenue)}</dd></div>
                <div><dt>계약금 합계</dt><dd>{won(group.totals.depositTotal)}</dd></div>
                <div><dt>수수료 합계</dt><dd>{won(group.totals.feeTotal)}</dd></div>
                <div><dt>미수금</dt><dd>{won(group.totals.outstandingTotal)}</dd></div>
              </dl>

              {group.months.map((month) => (
                <div key={month.month} className={styles.monthGroup}>
                  <h2>{monthLabel(month.month)}</h2>
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
                        {month.rows.map((row) => (
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
            </>
          ) : null}
        </div>
      ))}
    </section>
  );
}
