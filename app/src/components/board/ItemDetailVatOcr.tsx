"use client";

import { useCallback, useMemo, useState } from "react";
import { normalizeBizNo } from "@/lib/document-ocr/bizno";
import {
  parseVatCertificateText,
  type VatPeriodProposal,
} from "@/lib/document-ocr/parse-vat-certificate";

export type VatPeriodConfirmation = {
  sourceFileId: string;
  documentBizNo: string;
  periods: Array<Pick<VatPeriodProposal, "periodStart" | "periodEnd" | "salesAmount">>;
};

export type VatPeriodConfirmResult = { ok: boolean; message: string };

export function vatBizNumberMatch(expected: string, document: string): boolean {
  const left = normalizeBizNo(expected);
  const right = normalizeBizNo(document);
  return left.length === 10 && right.length === 10 && left === right;
}

export function formatVatAmount(value: string): string {
  return value.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function ItemDetailVatOcr({
  file,
  sourceFileId,
  expectedBizNo,
  onConfirm,
  buttonClassName,
}: {
  /** 보호 저장소 업로드에 사용한 바로 그 브라우저 File 객체. 재다운로드하지 않는다. */
  file: File;
  /** 확정된 첨부 ID. Phase B 저장 경계가 출처 파일을 다시 검증할 때 쓴다. */
  sourceFileId: string;
  /** 현재 항목/연계 회사에서 읽은 정본 사업자번호. 클라이언트 권한 주장은 아니다. */
  expectedBizNo: string;
  /** Phase B 서버 액션 연결점. 없으면 제안 확인까지만 하고 저장은 잠근다. */
  onConfirm?: (confirmation: VatPeriodConfirmation) => Promise<VatPeriodConfirmResult>;
  /** 상세 패널이 증빙 줄의 보조 버튼 모양을 넘긴다. 글자 크기는 패널 토큰을 따른다. */
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnType<typeof parseVatCertificateText> | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<VatPeriodConfirmResult | null>(null);

  const matched = result
    ? result.bizNoValid && vatBizNumberMatch(expectedBizNo, result.bizNo)
    : false;
  const validRows = useMemo(
    () => result?.periods.map((row, index) => ({ row, index })).filter(({ row }) => row.valid) ?? [],
    [result],
  );

  const run = useCallback(async () => {
    setOpen(true);
    setRunning(true);
    setError("");
    setResult(null);
    setSelected(new Set());
    setConfirmed(false);
    setSaveMessage(null);
    try {
      const { runDocumentOcr } = await import("@/lib/document-ocr/ocr-client");
      const engine = await runDocumentOcr(file);
      const parsed = parseVatCertificateText(engine.text);
      setResult(parsed);
      setSelected(new Set(parsed.periods.flatMap((row, index) => row.valid ? [index] : [])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "증명원을 읽지 못했습니다.");
    } finally {
      setRunning(false);
    }
  }, [file]);

  const close = useCallback(() => {
    setOpen(false);
    setError("");
    setSaveMessage(null);
  }, []);

  const confirm = useCallback(async () => {
    if (!result || !onConfirm || !matched || !confirmed || selected.size === 0) return;
    const periods = result.periods
      .filter((row, index) => selected.has(index) && row.valid)
      .map(({ periodStart, periodEnd, salesAmount }) => ({ periodStart, periodEnd, salesAmount }));
    if (periods.length === 0) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      setSaveMessage(await onConfirm({
        sourceFileId,
        documentBizNo: result.bizNo,
        periods,
      }));
    } catch {
      setSaveMessage({ ok: false, message: "확정 내용을 저장하지 못했습니다. 제안은 유지됩니다." });
    } finally {
      setSaving(false);
    }
  }, [result, onConfirm, matched, confirmed, selected, sourceFileId]);

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className={buttonClassName ?? "min-h-11 rounded-lg border border-mw-line px-3 py-2"}
        onClick={() => void run()}
      >
        부가세 증명원으로 읽기
      </button>
      {open ? (
        <section
          role="dialog"
          aria-label={`${file.name} 부가세 증명원 확인`}
          className="grid gap-3 rounded-xl border border-mw-line bg-mw-panel p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <b className="text-mw-strong">과세기간·매출액 제안</b>
            <button type="button" className="min-h-11 px-3" onClick={close} aria-label="부가세 제안 닫기">
              닫기
            </button>
          </div>
          <p className="text-mw-sub">
            이미 올라간 첨부는 그대로 두고, 같은 로컬 파일만 브라우저에서 읽습니다. 합계나 연간 매출은 추론하지 않습니다.
          </p>
          {running ? <p role="status" className="text-mw-sub">로컬에서 읽는 중…</p> : null}
          {error ? (
            <div className="grid gap-2" role="alert">
              <p className="text-mw-error">{error} 첨부는 이미 보존되어 있습니다.</p>
              <button type="button" className="min-h-11 rounded-lg border px-3" onClick={() => void run()}>
                같은 파일 다시 읽기
              </button>
            </div>
          ) : null}
          {result ? (
            <>
              <div className="grid gap-1 rounded-lg bg-mw-surface p-2">
                <span>문서 사업자번호: {result.bizNo || "읽지 못함"}</span>
                {!expectedBizNo ? (
                  <strong className="text-mw-error" role="alert">현재 항목의 정본 사업자번호가 없어 확정할 수 없습니다.</strong>
                ) : !matched ? (
                  <strong className="text-mw-error" role="alert">현재 항목의 사업자번호와 문서 번호가 달라 확정할 수 없습니다.</strong>
                ) : (
                  <strong className="text-mw-success">현재 항목의 사업자번호와 일치합니다.</strong>
                )}
              </div>
              {result.documentWarnings.length > 0 ? (
                <ul className="grid gap-1 text-mw-sub">
                  {result.documentWarnings.map((warning) => <li key={warning}>• {warning}</li>)}
                </ul>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left">
                  <thead><tr><th>반영</th><th>과세기간</th><th>매출액</th><th>확인</th></tr></thead>
                  <tbody>
                    {result.periods.map((row, index) => (
                      <tr key={`${row.periodStart}-${row.periodEnd}-${index}`}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${row.periodStart}~${row.periodEnd} 반영`}
                            checked={selected.has(index)}
                            disabled={!row.valid}
                            onChange={(event) => setSelected((prior) => {
                              const next = new Set(prior);
                              if (event.target.checked) next.add(index); else next.delete(index);
                              setConfirmed(false);
                              return next;
                            })}
                          />
                        </td>
                        <td>{row.periodStart} ~ {row.periodEnd}</td>
                        <td>{row.salesAmount ? `${formatVatAmount(row.salesAmount)}원` : "읽지 못함"}</td>
                        <td>{row.valid ? "제안" : row.warnings.join(" ") || "확인 필요"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.periods.length === 0 ? <p role="alert" className="text-mw-error">확정할 기간별 제안이 없습니다.</p> : null}
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!matched || selected.size === 0}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                문서 번호와 선택한 과세기간·매출액을 직접 확인했습니다.
              </label>
              {!onConfirm ? (
                <p className="text-mw-sub" role="status">
                  저장 연결은 다음 단계에서 열립니다. 지금은 제안 확인까지만 가능합니다.
                </p>
              ) : null}
              <button
                type="button"
                className="min-h-11 rounded-lg bg-mw-accent px-3 text-white disabled:opacity-50"
                disabled={!onConfirm || !matched || !confirmed || selected.size === 0 || saving || validRows.length === 0}
                onClick={() => void confirm()}
              >
                {saving ? "확정 중…" : `선택 ${selected.size}개 확정`}
              </button>
              {saveMessage ? (
                <p role={saveMessage.ok ? "status" : "alert"} className={saveMessage.ok ? "text-mw-success" : "text-mw-error"}>
                  {saveMessage.message}
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
