"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
} from "react";
import { saveNewLeadLoanProfileAction } from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import {
  existingLoanRecordsFromValues,
  existingLoanRecordsSummary,
  type ExistingLoanRecord,
} from "@/lib/new-lead/financial-profile";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";
import { BoardModalLayer } from "./BoardDialogPortal";
import styles from "./NewLeadLoanCell.module.css";
import {
  getLoanRecordSnapshot,
  loanRecordsDigest,
  publishLoanRecords,
  acknowledgeLoanRecordProps,
  resolveLoanRecords,
  subscribeToLoanRecords,
} from "./new-lead-loan-sync";
import { BOARD_TABLE_CONTROL } from "./table-style";

type ExistingLoanDraft = Omit<ExistingLoanRecord, "amount" | "rate"> & {
  amount: string;
  rate: string;
};

function toDraft(records: readonly ExistingLoanRecord[]): ExistingLoanDraft[] {
  return records.map((record) => ({
    ...record,
    amount: record.amount === null ? "" : String(record.amount),
    rate: record.rate === null ? "" : String(record.rate),
  }));
}

function toInitialDraft(
  values: Readonly<Record<string, CellValue | undefined>>,
  incomingRecords: readonly ExistingLoanRecord[],
  committedRecords: readonly ExistingLoanRecord[],
) {
  const incomingDraft = toDraft(existingLoanRecordsFromValues(values));
  return loanRecordsDigest(incomingRecords) === loanRecordsDigest(committedRecords)
    ? incomingDraft
    : toDraft(committedRecords);
}

function emptyRecord(): ExistingLoanDraft {
  return {
    id: crypto.randomUUID(),
    provider: "",
    month: "",
    amount: "",
    rate: "",
    terms: "",
    notes: "",
  };
}

export function NewLeadLoanCell({
  boardId,
  itemId,
  values,
  readOnly,
  controlId,
}: {
  boardId: string;
  itemId: string;
  values: Readonly<Record<string, CellValue | undefined>>;
  readOnly: boolean;
  controlId?: string;
}) {
  return (
    <NewLeadLoanCellInner
      key={`${boardId}\u0000${itemId}`}
      boardId={boardId}
      itemId={itemId}
      values={values}
      readOnly={readOnly}
      controlId={controlId}
    />
  );
}

function NewLeadLoanCellInner({
  boardId,
  itemId,
  values,
  readOnly,
  controlId,
}: {
  boardId: string;
  itemId: string;
  values: Readonly<Record<string, CellValue | undefined>>;
  readOnly: boolean;
  controlId?: string;
}) {
  const incomingRecords = useMemo(() => existingLoanRecordsFromValues(values), [values]);
  const consumerId = useId();
  const subscribe = useCallback(
    (listener: () => void) => subscribeToLoanRecords({ boardId, itemId }, consumerId, listener),
    [boardId, consumerId, itemId],
  );
  const getSnapshot = useCallback(
    () => getLoanRecordSnapshot({ boardId, itemId }),
    [boardId, itemId],
  );
  const getServerSnapshot = useCallback(() => null, []);
  const publishedSnapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resolution = resolveLoanRecords(publishedSnapshot, incomingRecords);
  const committedRecords = resolution.records;
  const committedDigest = loanRecordsDigest(committedRecords);
  const [draft, setDraft] = useState(() => ({
    records: toInitialDraft(values, incomingRecords, committedRecords),
    sourceDigest: committedDigest,
    dirty: false,
  }));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const sessionRef = useRef(0);
  const requestIdRef = useRef("");
  const mountedRef = useRef(false);
  const summary = committedRecords.length === 0 ? "0건" : existingLoanRecordsSummary(committedRecords);
  const records = draft.records;

  if (committedDigest !== draft.sourceDigest && (!open || !draft.dirty)) {
    setDraft({ records: toDraft(committedRecords), sourceDigest: committedDigest, dirty: false });
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (publishedSnapshot) {
      acknowledgeLoanRecordProps(
        { boardId, itemId },
        consumerId,
        publishedSnapshot,
        incomingRecords,
        resolution.disposition,
      );
    }
  }, [boardId, consumerId, incomingRecords, itemId, publishedSnapshot, resolution.disposition]);

  const openEditor = () => {
    sessionRef.current += 1;
    requestIdRef.current = crypto.randomUUID();
    setDraft({ records: toDraft(committedRecords), sourceDigest: committedDigest, dirty: false });
    setError("");
    setOpen(true);
  };
  const closeEditor = () => {
    if (pendingRef.current) return;
    sessionRef.current += 1;
    setDraft({ records: toDraft(committedRecords), sourceDigest: committedDigest, dirty: false });
    setError("");
    setOpen(false);
  };
  const updateRecord = (id: string, patch: Partial<ExistingLoanDraft>) => {
    if (error) {
      requestIdRef.current = crypto.randomUUID();
      setError("");
    }
    setDraft((current) => ({
      ...current,
      dirty: true,
      records: current.records.map((record) => record.id === id ? { ...record, ...patch } : record),
    }));
  };
  const addRecord = () => {
    if (error) {
      requestIdRef.current = crypto.randomUUID();
      setError("");
    }
    setDraft((current) => current.records.length >= 20 ? current : {
      ...current,
      dirty: true,
      records: [...current.records, emptyRecord()],
    });
  };
  const removeRecord = (recordId: string) => {
    if (error) {
      requestIdRef.current = crypto.randomUUID();
      setError("");
    }
    setDraft((current) => ({
      ...current,
      dirty: true,
      records: current.records.filter((entry) => entry.id !== recordId),
    }));
  };
  const submitRecords = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;

    pendingRef.current = true;
    const submittedSession = sessionRef.current;
    const submittedRequestId = requestIdRef.current;
    const submittedTarget = { boardId, itemId };
    const formData = new FormData(event.currentTarget);
    formData.set("requestId", submittedRequestId);
    setError("");

    startTransition(async () => {
      try {
        const result = await saveNewLeadLoanProfileAction({ ok: false, message: "" }, formData);
        if (!mountedRef.current || submittedSession !== sessionRef.current) return;
        if (
          result.requestId !== submittedRequestId
          || result.boardId !== submittedTarget.boardId
          || result.itemId !== submittedTarget.itemId
        ) {
          setError("저장 응답 대상을 확인하지 못했습니다. 다시 시도해 주세요.");
          return;
        }
        if (!result.ok) {
          setError(result.message || "기대출을 저장하지 못했습니다.");
          return;
        }
        publishLoanRecords(submittedTarget, result.records, committedRecords);
        sessionRef.current += 1;
        setOpen(false);
      } catch {
        if (mountedRef.current && submittedSession === sessionRef.current) {
          setError("기대출을 저장하지 못했습니다. 다시 시도해 주세요.");
        }
      } finally {
        pendingRef.current = false;
      }
    });
  };

  if (readOnly) return <span className="block truncate text-xs text-mw-body">{summary}</span>;

  return (
    <>
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        onClick={openEditor}
        className={`${BOARD_TABLE_CONTROL} truncate text-left`}
        aria-label={`기대출 편집: ${summary}`}
      >
        {summary}
      </button>
      {open ? (
        <BoardModalLayer label="기대출 편집" onClose={closeEditor} dismissible={!pending} returnFocusRef={triggerRef}>
          <form onSubmit={submitRecords} className={styles.panel}>
            <input type="hidden" name="boardId" value={boardId} />
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="loanRecords" value={JSON.stringify(records)} />
            <header className={styles.header}>
              <div>
                <h2 className="text-base font-semibold text-mw-fg">기대출</h2>
                <p className="mt-0.5 text-xs text-mw-sub">기관·연월·금액·금리와 조건을 대출별로 기록합니다.</p>
              </div>
              <div className={styles.headerActions}>
                <button type="button" onClick={closeEditor} disabled={pending} aria-label="기대출 편집 닫기" className={`${styles.touchTarget} rounded-lg text-mw-sub hover:bg-mw-bg disabled:opacity-50`}>✕</button>
              </div>
            </header>

            <div className={styles.body} data-loan-scroll-body>
              <div className={styles.recordList}>
                {records.length === 0 ? (
                  <p className={styles.empty}>등록된 기대출이 없습니다.</p>
                ) : records.map((record, index) => (
                  <section key={record.id} className={styles.record} aria-label={`기대출 ${index + 1}`}>
                    <div className={styles.recordHeader}>
                      <strong className="text-xs text-mw-fg">기대출 {index + 1}</strong>
                      <button type="button" disabled={pending} onClick={() => removeRecord(record.id)} className="min-h-9 px-2 text-xs text-mw-error disabled:opacity-50">삭제</button>
                    </div>
                    <div className={styles.recordGrid}>
                      <label className={styles.field}>진행기관
                        <input value={record.provider} onChange={(event) => updateRecord(record.id, { provider: event.target.value })} className={styles.control} placeholder="예: 기업은행" />
                      </label>
                      <label className={styles.field}>대출연월
                        <input type="month" value={record.month} onChange={(event) => updateRecord(record.id, { month: event.target.value })} className={styles.control} />
                      </label>
                      <label className={styles.field}>금액
                        <input inputMode="numeric" value={record.amount} onChange={(event) => updateRecord(record.id, { amount: event.target.value })} className={styles.control} placeholder="원 단위" />
                      </label>
                      <label className={styles.field}>금리
                        <span className={styles.rateField}><input inputMode="decimal" value={record.rate} onChange={(event) => updateRecord(record.id, { rate: event.target.value })} className={styles.control} placeholder="0.0" /><span className={styles.rateSuffix}>%</span></span>
                      </label>
                      <label className={`${styles.field} ${styles.terms}`}>조건
                        <input value={record.terms} onChange={(event) => updateRecord(record.id, { terms: event.target.value })} className={styles.control} placeholder="예: 만기일시상환, 보증서 90%" />
                      </label>
                      <label className={`${styles.field} ${styles.notes}`}>비고
                        <textarea value={record.notes} onChange={(event) => updateRecord(record.id, { notes: event.target.value })} rows={1} className={styles.textarea} />
                      </label>
                    </div>
                  </section>
                ))}
              </div>
            </div>

            {error ? <p role={noticeRole(false)} aria-live={noticeLive(false)} className="shrink-0 px-4 pt-2 text-xs text-mw-error">{error}</p> : null}
            <footer className={styles.footer}>
              <button type="button" onClick={addRecord} disabled={records.length >= 20 || pending} className="h-9 rounded-lg border border-mw-line bg-mw-card px-3 text-xs font-semibold text-mw-record disabled:opacity-50">＋ 기대출 추가 {records.length >= 20 ? "(최대 20건)" : ""}</button>
              <div className={styles.footerActions}>
                <button type="button" onClick={closeEditor} disabled={pending} className={`${styles.touchTarget} rounded-lg border border-mw-line bg-mw-card px-3 text-xs text-mw-sub disabled:opacity-50`}>취소</button>
                <button type="submit" disabled={pending} className={`${styles.touchTarget} rounded-lg bg-mw-primary px-4 text-xs font-semibold text-mw-on-accent disabled:opacity-60`}>{pending ? "저장 중…" : `${records.length}건 저장`}</button>
              </div>
            </footer>
          </form>
        </BoardModalLayer>
      ) : null}
    </>
  );
}
