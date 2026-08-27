"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveNewLeadCreditScoreAction,
  type SaveNewLeadFinancialState,
} from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import { CREDIT_SCORE_KEYS, formatCreditScoreValue } from "@/lib/new-lead/financial-profile";
import { BOARD_TABLE_CONTROL } from "./table-style";

type SaveCreditScoreAction = (
  previous: SaveNewLeadFinancialState,
  formData: FormData,
) => Promise<SaveNewLeadFinancialState>;

function durableText(value: CellValue | undefined): string {
  return formatCreditScoreValue(value);
}

function CreditScoreEditor({
  boardId,
  itemId,
  fieldKey,
  label,
  value,
  saveAction,
  onStatusChange,
}: {
  boardId: string;
  itemId: string;
  fieldKey: string;
  label: "NCB" | "KCB";
  value: CellValue | undefined;
  saveAction: SaveCreditScoreAction;
  onStatusChange?: (status: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const external = durableText(value);
  const externalRef = useRef(external);
  const attemptedRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const submittingRef = useRef(false);
  const armedSubmitRef = useRef(false);
  const attemptRef = useRef(0);
  const consumedAttemptRef = useRef(0);
  const statusChangeRef = useRef(onStatusChange);
  const [draft, setDraft] = useState(external);
  const [constraintError, setConstraintError] = useState("");
  const [dismissedAttempt, setDismissedAttempt] = useState(0);
  const [state, action, pending] = useActionState(async (previous: SaveNewLeadFinancialState & { attempt: number }, formData: FormData) => {
    try {
      return { ...await saveAction(previous, formData), attempt: attemptRef.current };
    } catch {
      return { ok: false, message: "저장 중 오류가 발생했습니다. 다시 시도해 주세요.", attempt: attemptRef.current };
    }
  }, { ok: false, message: "", attempt: 0 });
  const actionError = !pending && !state.ok && state.message && state.attempt > dismissedAttempt
    ? state.message
    : "";

  useEffect(() => {
    statusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (external === externalRef.current) return;
    externalRef.current = external;
    if (!dirtyRef.current) setDraft(external);
  }, [external]);

  useEffect(() => {
    if (
      pending
      || attemptedRef.current === null
      || state.attempt !== attemptRef.current
      || state.attempt <= consumedAttemptRef.current
    ) return;
    consumedAttemptRef.current = state.attempt;
    if (state.ok) {
      externalRef.current = attemptedRef.current;
      attemptedRef.current = null;
      dirtyRef.current = false;
      submittingRef.current = false;
      statusChangeRef.current?.("✓ 자동 저장됨");
      return;
    }
    if (state.message) {
      submittingRef.current = false;
      statusChangeRef.current?.("저장 확인 필요");
    }
  }, [pending, state.attempt, state.ok, state.message]);

  function beginSubmit() {
    setConstraintError("");
    setDismissedAttempt(attemptRef.current);
    submittingRef.current = true;
    attemptRef.current += 1;
    attemptedRef.current = draft;
    statusChangeRef.current?.("저장 중…");
  }

  function submitDraft() {
    if (!dirtyRef.current || submittingRef.current) return;
    if (!formRef.current?.reportValidity()) return;
    beginSubmit();
    armedSubmitRef.current = true;
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="relative"
      onSubmit={(event) => {
        if (armedSubmitRef.current) {
          armedSubmitRef.current = false;
          return;
        }
        if (!dirtyRef.current || submittingRef.current) {
          event.preventDefault();
          return;
        }
        beginSubmit();
      }}
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="fieldKey" value={fieldKey} />
      <label className="grid grid-cols-[auto_1fr] items-center gap-1 text-[0.65rem] text-mw-sub">
        {label}
        <input
          name="score"
          type="text"
          inputMode="numeric"
          pattern="[0-9,]*"
          value={draft}
          disabled={pending}
          aria-label={`${label} 신용점수`}
          aria-describedby={constraintError || actionError ? `${itemId}-${fieldKey}-error` : undefined}
          aria-invalid={Boolean(constraintError || actionError)}
          className={BOARD_TABLE_CONTROL + " text-right tabular-nums disabled:opacity-60"}
          placeholder="—"
          onChange={(event) => {
            const next = event.currentTarget.value;
            setDraft(next);
            setConstraintError("");
            setDismissedAttempt(state.attempt);
            dirtyRef.current = next !== externalRef.current;
            statusChangeRef.current?.(dirtyRef.current ? "저장 대기…" : "✓ 자동 저장됨");
          }}
          onBlur={submitDraft}
          onInvalid={() => {
            armedSubmitRef.current = false;
            submittingRef.current = false;
            setConstraintError("1~1,000 사이의 정수로 입력해 주세요.");
            statusChangeRef.current?.("저장 확인 필요");
          }}
        />
      </label>
      {constraintError || actionError ? <span id={`${itemId}-${fieldKey}-error`} role="alert" className="absolute left-0 top-full z-10 mt-1 w-48 rounded border border-mw-error bg-mw-card p-2 text-[0.65rem] text-mw-error shadow-lg">{constraintError || actionError}</span> : null}
    </form>
  );
}

export function NewLeadCreditScoresCell({
  boardId,
  itemId,
  ncb,
  kcb,
  readOnly,
  saveAction = saveNewLeadCreditScoreAction,
  onStatusChange,
}: {
  boardId: string;
  itemId: string;
  ncb: CellValue | undefined;
  kcb: CellValue | undefined;
  readOnly: boolean;
  saveAction?: SaveCreditScoreAction;
  onStatusChange?: (fieldKey: string, status: string) => void;
}) {
  const ncbValue = durableText(ncb);
  const kcbValue = durableText(kcb);

  if (readOnly) {
    return (
      <span className="grid grid-cols-2 gap-2 text-right text-xs tabular-nums text-mw-body">
        <span><span className="text-mw-sub">NCB</span> {ncbValue || "—"}</span>
        <span><span className="text-mw-sub">KCB</span> {kcbValue || "—"}</span>
      </span>
    );
  }

  return (
    <div className="relative grid grid-cols-2 gap-1" role="group" aria-label="신용점수">
      <CreditScoreEditor boardId={boardId} itemId={itemId} fieldKey={CREDIT_SCORE_KEYS.ncb} label="NCB" value={ncb} saveAction={saveAction} onStatusChange={(status) => onStatusChange?.(CREDIT_SCORE_KEYS.ncb, status)} />
      <CreditScoreEditor boardId={boardId} itemId={itemId} fieldKey={CREDIT_SCORE_KEYS.kcb} label="KCB" value={kcb} saveAction={saveAction} onStatusChange={(status) => onStatusChange?.(CREDIT_SCORE_KEYS.kcb, status)} />
    </div>
  );
}
