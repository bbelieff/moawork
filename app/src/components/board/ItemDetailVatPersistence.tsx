"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmItemVatPeriodsAction,
  loadItemVatPeriodsAction,
} from "@/app/(app)/boards/item-detail-vat-actions";
import type { VatPeriodConfirmationInput, VatPeriodSnapshot } from "@/lib/document-ocr/vat-period-persistence";
import { ItemDetailVatOcr, type VatPeriodConfirmResult } from "./ItemDetailVatOcr";

export function ItemDetailVatPersistence({
  boardId,
  itemId,
  file,
  sourceFileId,
  expectedBizNo,
}: {
  boardId: string;
  itemId: string;
  file: File;
  sourceFileId: string;
  expectedBizNo: string;
}) {
  const [snapshot, setSnapshot] = useState<VatPeriodSnapshot | null>(null);
  const [readMessage, setReadMessage] = useState("저장 연결을 확인하는 중…");
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadItemVatPeriodsAction({ boardId, itemId }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setSnapshot(result.data);
        setReadMessage(result.data.periods.length > 0
          ? `저장된 기간별 자료 ${result.data.periods.length}건`
          : "저장된 기간별 자료가 없습니다.");
      } else {
        setSnapshot(null);
        setReadMessage(`${result.error} 저장 확정은 잠겨 있습니다.`);
      }
    }).catch(() => {
      if (!active) return;
      setSnapshot(null);
      setReadMessage("저장 연결을 확인하지 못했습니다. 첨부 파일은 그대로 보존되며 저장 확정은 잠겨 있습니다.");
    });
    return () => { active = false; };
  }, [boardId, itemId]);

  const confirm = useCallback(async (
    confirmation: VatPeriodConfirmationInput,
  ): Promise<VatPeriodConfirmResult> => {
    if (!snapshot || confirmation.sourceFileId !== sourceFileId) {
      return { ok: false, message: "저장 연결 또는 첨부 파일을 다시 확인해 주세요. 첨부와 제안은 유지됩니다." };
    }
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    const result = await confirmItemVatPeriodsAction({
      boardId,
      itemId,
      requestId,
      expectedVersion: snapshot.version,
      confirmation,
    });
    if (!result.ok) return { ok: false, message: result.error };
    requestIdRef.current = null;
    setSnapshot(result.data);
    setReadMessage(`저장된 기간별 자료 ${result.data.periods.length}건`);
    return { ok: true, message: result.message };
  }, [boardId, itemId, snapshot, sourceFileId]);

  return (
    <section className="grid gap-2" aria-label="부가세 기간별 자료 저장">
      <ItemDetailVatOcr
        file={file}
        sourceFileId={sourceFileId}
        expectedBizNo={expectedBizNo}
        onConfirm={snapshot ? confirm : undefined}
      />
      <p role={snapshot ? "status" : "alert"} className="text-xs text-mw-sub">
        {readMessage}
      </p>
      {snapshot?.periods.length ? (
        <ul aria-label="저장된 부가세 기간별 자료" className="grid gap-1 text-xs text-mw-sub">
          {snapshot.periods.map((period) => (
            <li key={`${period.periodStart}:${period.periodEnd}`}>
              {period.periodStart} ~ {period.periodEnd} · {period.salesAmount}원
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
