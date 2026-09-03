"use client";

import { useRef, useState, type KeyboardEvent } from "react";
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

const ledgerModeTabId = (mode: Mode) => `ledger-mode-tab-${mode}`;
const ledgerModePanelId = (mode: Mode) => `ledger-mode-panel-${mode}`;

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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectMode(next: Mode, focus = false) {
    setMode(next);
    if (focus) tabRefs.current[MODES.findIndex((item) => item.key === next)]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % MODES.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + MODES.length) % MODES.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = MODES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectMode(MODES[nextIndex].key, true);
  }

  return (
    <>
      <div className={styles.modeTabs} role="tablist" aria-label="원장 보기 방식" data-print="hide">
        {MODES.map((item, index) => (
          <button
            key={item.key}
            ref={(node) => { tabRefs.current[index] = node; }}
            id={ledgerModeTabId(item.key)}
            type="button"
            role="tab"
            aria-controls={ledgerModePanelId(item.key)}
            aria-selected={item.key === mode}
            tabIndex={item.key === mode ? 0 : -1}
            onClick={() => selectMode(item.key)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {MODES.map((item) => (
        <div
          key={item.key}
          id={ledgerModePanelId(item.key)}
          role="tabpanel"
          aria-labelledby={ledgerModeTabId(item.key)}
          hidden={mode !== item.key}
        >
          {mode === item.key
            ? item.key === "yearly"
              ? <YearlyLedgerView groups={years} />
              : <LedgerReportView rows={rows} printedOn={printedOn} printedBy={printedBy} />
            : null}
        </div>
      ))}
    </>
  );
}
