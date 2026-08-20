"use client";

import { useState } from "react";
import type { LedgerReportRow } from "@/lib/accounting/report";
import type { YearlyLedgerYearGroup } from "@/lib/accounting/yearly";
import { LedgerReportView } from "./LedgerReportView";
import { YearlyLedgerView } from "./YearlyLedgerView";
import styles from "./accounting.module.css";

export interface LedgerScreenProps {
  years: readonly YearlyLedgerYearGroup[];
  rows: readonly LedgerReportRow[];
  printedOn: string;
  printedBy: string;
}

const MODES = [
  { key: "yearly", label: "연도별" },
  { key: "report", label: "리포트" },
] as const;

type Mode = (typeof MODES)[number]["key"];

/**
 * /ledger 의 두 모드 — 「연도별」(기존) 과 「리포트」(정산 리포트 시안 §②).
 *
 * 리포트를 기존 화면 «위에» 얹지 않고 옆에 붙인 이유: 연도별 원장은 이미 쓰이는 화면이고
 * 총괄 지시는 「연도 탭 위에 리포트 탭 추가」였다. 기본값은 그대로 연도별이라 이 커밋으로
 * 기존 사용자의 첫 화면이 바뀌지 않는다.
 *
 * 두 모드가 **같은 행 한 벌**에서 갈라진다(loadLedgerScreen). 원장을 두 번 읽지 않는다.
 */
export function LedgerScreen({ years, rows, printedOn, printedBy }: LedgerScreenProps) {
  const [mode, setMode] = useState<Mode>("yearly");

  return (
    <>
      <div className={styles.modeTabs} role="tablist" aria-label="원장 보기 방식" data-print="hide">
        {MODES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === mode}
            onClick={() => setMode(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {mode === "yearly" ? (
        <YearlyLedgerView groups={years} />
      ) : (
        <LedgerReportView rows={rows} printedOn={printedOn} printedBy={printedBy} />
      )}
    </>
  );
}
