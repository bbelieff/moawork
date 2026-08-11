"use client";

import { useState } from "react";
import type { DealLedgerEntry } from "@/lib/accounting";
import { createLedgerCsvExport } from "@/lib/accounting/export";
import styles from "./accounting.module.css";

export interface LedgerExportButtonProps {
  entries: readonly DealLedgerEntry[];
  initialFrom: string;
  initialTo: string;
}

export function LedgerExportButton({ entries, initialFrom, initialTo }: LedgerExportButtonProps) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [message, setMessage] = useState<string | null>(null);

  function download(): void {
    try {
      const result = createLedgerCsvExport(entries, { from, to });
      const blob = new Blob([result.content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`${result.rowCount}건을 엑셀용 CSV로 준비했어요.`);
    } catch {
      setMessage("기간을 다시 확인해 주세요.");
    }
  }

  return (
    <section className={styles.export} aria-labelledby="ledger-export-title">
      <div>
        <h2 id="ledger-export-title">기간별 내보내기</h2>
        <p>발생일 기준으로 고른 기간만 엑셀용 CSV로 내려받아요.</p>
      </div>
      <div className={styles.period}>
        <label>시작일<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>종료일<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="button" onClick={download}>엑셀용 CSV 내려받기</button>
      </div>
      {message ? <p className={styles.exportMessage} role="status">{message}</p> : null}
    </section>
  );
}
