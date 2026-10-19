"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveNewLeadRevenue3yAction,
  type SaveNewLeadFinancialState,
} from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import { formatRevenue3yMillion } from "@/lib/new-lead/financial-profile";
import { formatQuantity } from "@/lib/format/number";
import { readRevenueYears, revenueYearsSummary } from "@/lib/new-lead/revenue-years";
import { BOARD_TABLE_CONTROL } from "./table-style";
import { groupIfPlainNumber } from "@/lib/format/group-digits";

export function NewLeadRevenue3yCell({
  boardId,
  itemId,
  value,
  legacyRevenueBand,
  /* #673 — 「매출」 칸에 네 해가 물린다. 값은 상세 전용 필드로 같은 item_values 에 쌓인다. */
  years,
  readOnly,
  saveAction = saveNewLeadRevenue3yAction,
  onStatusChange,
}: {
  boardId: string;
  itemId: string;
  value: CellValue | undefined;
  legacyRevenueBand: CellValue | undefined;
  years?: Record<string, unknown>;
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
      ? groupIfPlainNumber(value)
      : "";
  const legacy = typeof legacyRevenueBand === "string" ? groupIfPlainNumber(legacyRevenueBand.trim()) : "";
  /* 적힌 해만 줄여 보인다. 하나도 없으면 줄 자체가 없다 — 빈 줄이 표를 늘리지 않게. */
  const yearsLine = revenueYearsSummary(readRevenueYears(years ?? {}));
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
  // 백만원 단위라 1,000,000 이상이면 1조 원 — 원 단위로 잘못 친 값일 가능성이 크다(2026-10-19 검토).
  const draftNumber = Number(draft.replace(/[,\s]/g, ""));
  const implausible = draft.trim() !== "" && Number.isFinite(draftNumber) && draftNumber >= 1_000_000;
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
          aria-describedby={[itemId + "-revenue-3y-unit", constraintError || actionError ? itemId + "-revenue-3y-error" : legacy ? itemId + "-revenue-3y-legacy" : "", implausible ? itemId + "-revenue-3y-check" : ""].filter(Boolean).join(" ")}
          aria-invalid={Boolean(constraintError || actionError)}
          placeholder={legacy || "0"}
          data-has-value={legacy ? "true" : undefined}
          className={BOARD_TABLE_CONTROL + " pr-14 text-right tabular-nums disabled:opacity-60"}
          onChange={(event) => {
            const next = groupIfPlainNumber(event.currentTarget.value);
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
        <span id={itemId + "-revenue-3y-unit"} aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[0.65rem] text-mw-sub">백만원</span>
      </div>
      {yearsLine ? (
        <span className="mt-0.5 block truncate text-[0.6rem] tabular-nums text-mw-sub" title={yearsLine}>
          {yearsLine}
        </span>
      ) : null}
      {legacy && numeric === null ? <span id={itemId + "-revenue-3y-legacy"} className="sr-only">기존 매출 구간 {legacy}는 보존됩니다.</span> : null}
      {implausible ? <span id={itemId + "-revenue-3y-check"} className="mt-0.5 block whitespace-normal text-[0.65rem] text-mw-warning">1조 원이 넘어요 — 백만원 단위가 맞는지 확인해 주세요.</span> : null}
      {/* 칸(td)이 넘치는 부분을 잘라 떠 있는 말풍선은 보이지 않았다 — 칸 안 아래 줄에 적는다. */}
      {constraintError || actionError ? <span id={itemId + "-revenue-3y-error"} role="alert" className="mt-0.5 block whitespace-normal text-[0.65rem] text-mw-error">{constraintError || actionError}</span> : null}
    </form>
  );
}
