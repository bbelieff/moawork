"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveNewLeadRevenue3yAction,
  type SaveNewLeadFinancialState,
} from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import { formatRevenue3yMillion } from "@/lib/new-lead/financial-profile";
import { BOARD_TABLE_CONTROL } from "./table-style";

export function NewLeadRevenue3yCell({
  boardId,
  itemId,
  value,
  legacyRevenueBand,
  readOnly,
  saveAction = saveNewLeadRevenue3yAction,
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
}) {
  const numeric = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const shown = numeric !== null
    ? numeric.toLocaleString("ko-KR")
    : typeof value === "string"
      ? value
      : "";
  const legacy = typeof legacyRevenueBand === "string" ? legacyRevenueBand.trim() : "";
  const formRef = useRef<HTMLFormElement>(null);
  const externalRef = useRef(shown);
  const attemptedRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const [draft, setDraft] = useState(shown);
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState(saveAction, { ok: false, message: "" });

  useEffect(() => {
    if (shown === externalRef.current) return;
    externalRef.current = shown;
    if (!dirtyRef.current) setDraft(shown);
  }, [shown]);

  useEffect(() => {
    if (pending || !state.ok || attemptedRef.current === null) return;
    externalRef.current = attemptedRef.current;
    attemptedRef.current = null;
    dirtyRef.current = false;
    setDirty(false);
  }, [pending, state.ok, state.message]);

  if (readOnly) {
    return (
      <span className="block text-right text-xs tabular-nums text-mw-body">
        {formatRevenue3yMillion(value) || (legacy ? "기존 구간: " + legacy : "—")}
      </span>
    );
  }

  return (
    <form ref={formRef} action={action} className="relative">
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
          aria-describedby={state.message && !state.ok ? itemId + "-revenue-3y-error" : legacy ? itemId + "-revenue-3y-legacy" : undefined}
          aria-invalid={!state.ok && Boolean(state.message)}
          placeholder={legacy || "0"}
          className={BOARD_TABLE_CONTROL + " pr-14 text-right tabular-nums disabled:opacity-60"}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setDraft(next);
            dirtyRef.current = next !== externalRef.current;
            setDirty(dirtyRef.current);
          }}
          onBlur={() => {
            if (!dirty) return;
            attemptedRef.current = draft;
            formRef.current?.requestSubmit();
          }}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[0.65rem] text-mw-sub">백만원</span>
      </div>
      {legacy && numeric === null ? <span id={itemId + "-revenue-3y-legacy"} className="sr-only">기존 매출 구간 {legacy}는 보존됩니다.</span> : null}
      {state.message && !state.ok ? <span id={itemId + "-revenue-3y-error"} role="alert" className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-mw-error bg-mw-card p-2 text-[0.65rem] text-mw-error shadow-lg">{state.message}</span> : null}
    </form>
  );
}
