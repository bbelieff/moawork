"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveNewLeadFoundedDateAction,
  type SaveNewLeadFinancialState,
} from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import { formatFoundedDate } from "@/lib/new-lead/financial-profile";
import { BOARD_TABLE_CONTROL } from "./table-style";

export function NewLeadFoundedDateCell({
  boardId,
  itemId,
  value,
  readOnly,
  saveAction = saveNewLeadFoundedDateAction,
  onStatusChange,
}: {
  boardId: string;
  itemId: string;
  value: CellValue | undefined;
  readOnly: boolean;
  saveAction?: (
    previous: SaveNewLeadFinancialState,
    formData: FormData,
  ) => Promise<SaveNewLeadFinancialState>;
  onStatusChange?: (status: string) => void;
}) {
  const shown = typeof value === "string" ? value : "";
  const formRef = useRef<HTMLFormElement>(null);
  const externalRef = useRef(shown);
  const attemptedRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const submittingRef = useRef(false);
  const armedSubmitRef = useRef(false);
  const attemptRef = useRef(0);
  const consumedAttemptRef = useRef(0);
  const statusChangeRef = useRef(onStatusChange);
  const [draft, setDraft] = useState(shown);
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
    if (shown === externalRef.current) return;
    externalRef.current = shown;
    if (!dirtyRef.current) setDraft(shown);
  }, [shown]);

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

  if (readOnly) return <span className="block text-xs tabular-nums text-mw-body">{formatFoundedDate(value)}</span>;

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
      <input
        name="foundedDate"
        type="text"
        inputMode="numeric"
        pattern="\d{4}-(0[1-9]|1[0-2])(-([0-2]\d|3[01]))?"
        value={draft}
        disabled={pending}
        aria-label="창업연월"
        aria-describedby={constraintError || actionError ? itemId + "-founded-date-error" : undefined}
        aria-invalid={Boolean(constraintError || actionError)}
        placeholder="YYYY-MM 또는 YYYY-MM-DD"
        className={BOARD_TABLE_CONTROL + " tabular-nums disabled:opacity-60"}
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
          setConstraintError("YYYY-MM 또는 YYYY-MM-DD 형식으로 입력해 주세요.");
          statusChangeRef.current?.("저장 확인 필요");
        }}
      />
      {constraintError || actionError ? <span id={itemId + "-founded-date-error"} role="alert" className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-mw-error bg-mw-card p-2 text-[0.65rem] text-mw-error shadow-lg">{constraintError || actionError}</span> : null}
    </form>
  );
}
