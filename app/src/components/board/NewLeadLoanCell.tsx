"use client";

import { useActionState, useState } from "react";
import { saveNewLeadLoanProfileAction } from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import {
  existingLoanRecordsFromValues,
  existingLoanRecordsSummary,
  type ExistingLoanRecord,
} from "@/lib/new-lead/financial-profile";
import { BoardModalLayer } from "./BoardDialogPortal";

const CONTROL = "h-9 w-full rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs text-mw-fg outline-none focus:border-mw-record";

function emptyRecord(): ExistingLoanRecord {
  return {
    id: crypto.randomUUID(),
    provider: "",
    month: "",
    amount: null,
    rate: null,
    terms: "",
    notes: "",
  };
}

export function NewLeadLoanCell({
  boardId,
  itemId,
  values,
  readOnly,
}: {
  boardId: string;
  itemId: string;
  values: Readonly<Record<string, CellValue | undefined>>;
  readOnly: boolean;
}) {
  const initialRecords = existingLoanRecordsFromValues(values);
  const [records, setRecords] = useState<ExistingLoanRecord[]>(initialRecords);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveNewLeadLoanProfileAction, { ok: false, message: "" });
  const summary = existingLoanRecordsSummary(records);
  const openEditor = () => {
    setRecords(existingLoanRecordsFromValues(values));
    setOpen(true);
  };
  const closeEditor = () => {
    setRecords(existingLoanRecordsFromValues(values));
    setOpen(false);
  };
  const updateRecord = (id: string, patch: Partial<ExistingLoanRecord>) => {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, ...patch } : record));
  };

  if (readOnly) return <span className="block truncate text-xs text-mw-body">{summary}</span>;

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        className="h-7 w-full truncate rounded border border-mw-line bg-mw-card px-2 text-left text-xs text-mw-fg hover:border-mw-record"
        aria-label={`기대출 편집: ${summary}`}
      >
        {summary}
      </button>
      {open ? (
        <BoardModalLayer label="기대출 편집" onClose={closeEditor}>
          <form action={action} className="max-h-[calc(100vh-1.5rem)] w-[min(44rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-mw-line bg-mw-card p-4 shadow-xl">
            <input type="hidden" name="boardId" value={boardId} />
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="loanRecords" value={JSON.stringify(records)} />
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-mw-fg">기대출</h2>
                <p className="mt-1 text-xs text-mw-sub">대출마다 진행기관·연월·금액·금리·조건·비고를 따로 기록합니다.</p>
              </div>
              <button type="button" onClick={closeEditor} aria-label="기대출 편집 닫기" className="rounded p-1 text-mw-sub hover:bg-mw-bg">✕</button>
            </div>

            <div className="grid gap-3">
              {records.length === 0 ? (
                <p className="rounded-lg border border-dashed border-mw-line bg-mw-bg p-4 text-center text-xs text-mw-sub">등록된 기대출이 없습니다.</p>
              ) : records.map((record, index) => (
                <section key={record.id} className="rounded-xl border border-mw-line bg-mw-card p-3" aria-label={`기대출 ${index + 1}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <strong className="text-xs text-mw-fg">기대출 {index + 1}</strong>
                    <button type="button" onClick={() => setRecords((current) => current.filter((entry) => entry.id !== record.id))} className="text-xs text-mw-error">삭제</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs text-mw-sub">진행기관
                      <input value={record.provider} onChange={(event) => updateRecord(record.id, { provider: event.target.value })} className={CONTROL} placeholder="예: 기업은행" />
                    </label>
                    <label className="grid gap-1 text-xs text-mw-sub">대출연월
                      <input type="month" value={record.month} onChange={(event) => updateRecord(record.id, { month: event.target.value })} className={CONTROL} />
                    </label>
                    <label className="grid gap-1 text-xs text-mw-sub">금액
                      <input inputMode="numeric" value={record.amount ?? ""} onChange={(event) => updateRecord(record.id, { amount: event.target.value ? Number(event.target.value.replaceAll(",", "")) : null })} className={CONTROL} placeholder="원 단위" />
                    </label>
                    <label className="grid gap-1 text-xs text-mw-sub">금리
                      <div className="relative"><input inputMode="decimal" value={record.rate ?? ""} onChange={(event) => updateRecord(record.id, { rate: event.target.value ? Number(event.target.value) : null })} className={`${CONTROL} pr-7`} placeholder="0.0" /><span className="pointer-events-none absolute right-2.5 top-2.5 text-xs text-mw-sub">%</span></div>
                    </label>
                    <label className="grid gap-1 text-xs text-mw-sub sm:col-span-2">조건
                      <input value={record.terms} onChange={(event) => updateRecord(record.id, { terms: event.target.value })} className={CONTROL} placeholder="예: 만기일시상환, 보증서 90%" />
                    </label>
                    <label className="grid gap-1 text-xs text-mw-sub sm:col-span-2">비고
                      <textarea value={record.notes} onChange={(event) => updateRecord(record.id, { notes: event.target.value })} rows={2} className="w-full resize-y rounded-lg border border-mw-line bg-mw-card px-2.5 py-2 text-xs text-mw-fg outline-none focus:border-mw-record" />
                    </label>
                  </div>
                </section>
              ))}
            </div>

            <button type="button" onClick={() => setRecords((current) => [...current, emptyRecord()])} disabled={records.length >= 20} className="mt-3 h-9 w-full rounded-lg border border-dashed border-mw-record bg-mw-card text-xs font-semibold text-mw-record disabled:opacity-50">＋ 기대출 추가</button>
            {state.message ? <p role="status" className={`mt-3 text-xs ${state.ok ? "text-mw-success" : "text-mw-error"}`}>{state.message}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeEditor} className="h-9 rounded-lg border border-mw-line bg-mw-card px-3 text-xs text-mw-sub">취소</button>
              <button type="submit" disabled={pending} className="h-9 rounded-lg bg-mw-primary px-4 text-xs font-semibold text-mw-on-accent disabled:opacity-60">{pending ? "저장 중…" : `${records.length}건 저장`}</button>
            </div>
          </form>
        </BoardModalLayer>
      ) : null}
    </>
  );
}
