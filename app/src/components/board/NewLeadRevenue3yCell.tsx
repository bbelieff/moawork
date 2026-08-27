"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveNewLeadRevenue3yAction,
  type SaveNewLeadFinancialState,
} from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import { formatRevenue3yMillion } from "@/lib/new-lead/financial-profile";
import { formatQuantity } from "@/lib/format/number";
import { BOARD_TABLE_CONTROL } from "./table-style";

export function NewLeadRevenue3yCell({
  boardId,
  itemId,
  value,
  legacyRevenueBand,
  readOnly,
  saveAction = saveNewLeadRevenue3yAction,
  onStatusChange,
}: {
  boardId: string;
  itemId: string;
  value: CellValue | undefined;
  legacyRevenueBand: CellValue | undefined;
  readOnly: boolean;
  saveAction?: (
    previous: SaveNewLeadFinancialState,
    formData: FormData,
  ) => Promise<SaveNewLeadFinancialState>;
  onStatusChange?: (status: string) => void;
}) {
  const numeric = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const shown = numeric !== null
    ? formatQuantity(numeric)
    : typeof value === "string"
      ? value
      : "";
  const legacy = typeof legacyRevenueBand === "string" ? legacyRevenueBand.trim() : "";
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

  if (readOnly) {
    return (
      <span className="block text-right text-xs tabular-nums text-mw-body">
        {formatRevenue3yMillion(value) || (legacy ? "기존 구간: " + legacy : "—")}
      </span>
    );
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
      <div className="relative">
        <input
          name="revenue3yMillion"
          type="text"
          inputMode="numeric"
          pattern="[0-9,]*"
          value={draft}
          disabled={pending}
          aria-label="3개년매출"
          aria-describedby={constraintError || actionError ? itemId + "-revenue-3y-error" : legacy ? itemId + "-revenue-3y-legacy" : undefined}
          aria-invalid={Boolean(constraintError || actionError)}
          placeholder={legacy || "0"}
          className={BOARD_TABLE_CONTROL + " pr-14 text-right tabular-nums disabled:opacity-60"}
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
            setConstraintError("0 이상의 정수를 백만원 단위로 입력해 주세요.");
            statusChangeRef.current?.("저장 확인 필요");
          }}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[0.65rem] text-mw-sub">백만원</span>
      </div>
      {legacy && numeric === null ? <span id={itemId + "-revenue-3y-legacy"} className="sr-only">기존 매출 구간 {legacy}는 보존됩니다.</span> : null}
      {constraintError || actionError ? <span id={itemId + "-revenue-3y-error"} role="alert" className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-mw-error bg-mw-card p-2 text-[0.65rem] text-mw-error shadow-lg">{constraintError || actionError}</span> : null}
    </form>
  );
}
