"use client";

import { useState } from "react";
import type { DealLedgerEntry } from "@/lib/accounting";
import { createLedgerCsvExport } from "@/lib/accounting/export";
import { authorizeLedgerCsvExport } from "@/lib/accounting/export/actions";
import styles from "./accounting.module.css";

export interface LedgerExportButtonProps {
  entries: readonly DealLedgerEntry[];
  initialFrom: string;
  initialTo: string;
}

/** 화면에 무엇을 보여줄지 정하는 «판정». 성공이면 ok:true, 그 외 전부 ok:false. */
export type LedgerExportFeedback = Readonly<{ ok: boolean; message: string }>;

/**
 * 내보내기 결과 판정만 담당한다 — 표현(색·role)과 분리해 둔 이유는
 * **실패 경로를 실패 그대로 테스트할 수 있게** 하기 위해서다(BBE-193).
 * 특히 `catch` 는 「파일이 만들어지지 않았다」는 뜻이므로 반드시 ok:false 로 남아야 한다.
 * 여기서 조용히 ok:true 를 돌려주면 사용자는 받지도 않은 파일을 받은 줄 안다.
 */
export async function resolveLedgerExportFeedback(
  authorize: () => Promise<{ readonly ok: false; readonly message: string } | { readonly ok: true }>,
  writeFile: () => { readonly rowCount: number },
): Promise<LedgerExportFeedback> {
  try {
    const authorization = await authorize();
    if (!authorization.ok) return { ok: false, message: authorization.message };
    const result = writeFile();
    return { ok: true, message: `${result.rowCount}건을 엑셀용 CSV로 준비했어요.` };
  } catch {
    return { ok: false, message: "기간을 다시 확인해 주세요." };
  }
}

export function LedgerExportButton({ entries, initialFrom, initialTo }: LedgerExportButtonProps) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  // 판정 근거를 문구와 «함께» 들고 다닌다. 예전엔 message 만 저장해서 authorization.ok 가
  // 그 자리에서 버려졌고, 권한 거부가 성공과 똑같이 보였다(BBE-193).
  const [feedback, setFeedback] = useState<LedgerExportFeedback | null>(null);

  async function download(): Promise<void> {
    setFeedback(await resolveLedgerExportFeedback(authorizeLedgerCsvExport, () => {
      const result = createLedgerCsvExport(entries, { from, to });
      const blob = new Blob([result.content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      return result;
    }));
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
      {feedback ? (
        <p
          className={`${styles.exportMessage} ${feedback.ok ? styles.exportOk : styles.exportFailed}`}
          role={feedback.ok ? "status" : "alert"}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}
