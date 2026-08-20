"use client";

import { useState } from "react";
import type { LedgerCsvExport } from "@/lib/accounting/export";
import { authorizeLedgerCsvExport } from "@/lib/accounting/export/actions";
import styles from "./accounting.module.css";

export interface LedgerExportButtonProps {
  /**
   * 눌린 «그 순간» 의 화면을 CSV 로 만든다. 미리 만들어 둔 문자열을 받지 않는 이유:
   * 필터가 바뀌어도 버튼이 옛 파일을 뱉는 사고를 구조적으로 막기 위해서다.
   */
  build: () => LedgerCsvExport;
  label?: string;
  className?: string;
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

/**
 * 원장 CSV 내려받기 버튼 (BBE-198).
 *
 * 권한(`danger.csv_export`) 확인과 위험행동 기록은 서버 액션이 한다 —
 * 감사 기록에 실패하면 파일을 «만들지 않는다»(authorizeLedgerCsvExport).
 * 기간 입력은 여기 없다: 리포트 화면의 필터바가 조건의 정본이고, 이 버튼은 그 화면을
 * 그대로 파일로 옮길 뿐이다(총괄 승인 — 「화면 리포트를 정본으로」).
 */
export function LedgerExportButton({ build, label = "CSV", className }: LedgerExportButtonProps) {
  // 판정 근거를 문구와 «함께» 들고 다닌다. 예전엔 message 만 저장해서 authorization.ok 가
  // 그 자리에서 버려졌고, 권한 거부가 성공과 똑같이 보였다(BBE-193).
  const [feedback, setFeedback] = useState<LedgerExportFeedback | null>(null);

  async function download(): Promise<void> {
    setFeedback(await resolveLedgerExportFeedback(authorizeLedgerCsvExport, () => {
      const result = build();
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
    <span className={styles.exportControl}>
      <button type="button" className={className} onClick={download}>{label}</button>
      {feedback ? (
        <span
          className={`${styles.exportMessage} ${feedback.ok ? styles.exportOk : styles.exportFailed}`}
          role={feedback.ok ? "status" : "alert"}
        >
          {feedback.message}
        </span>
      ) : null}
    </span>
  );
}
