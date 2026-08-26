"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  saveNewLeadCreditScoreAction,
} from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";

export function NewLeadCreditScoreCell({
  boardId,
  itemId,
  fieldKey,
  label,
  value,
  readOnly,
}: {
  boardId: string;
  itemId: string;
  fieldKey: string;
  label: "NCB" | "KCB";
  value: CellValue;
  readOnly: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    saveNewLeadCreditScoreAction,
    { ok: false, message: "" },
  );
  const shown = typeof value === "number" || typeof value === "string" ? value : "";
  const lastSubmittedRef = useRef(String(shown));
  const attemptedValueRef = useRef<string | null>(null);

  useEffect(() => {
    if (pending || !state.ok || attemptedValueRef.current === null) return;
    lastSubmittedRef.current = attemptedValueRef.current;
    attemptedValueRef.current = null;
  }, [pending, state.ok, state.message]);

  if (readOnly) return <span className="block text-right text-xs tabular-nums text-mw-body">{shown || "—"}</span>;

  return (
    <form ref={formRef} action={action} className="relative">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="fieldKey" value={fieldKey} />
      <input
        name="score"
        type="number"
        min={1}
        max={1000}
        step={1}
        defaultValue={shown}
        disabled={pending}
        aria-label={`${label} 신용점수`}
        aria-invalid={!state.ok && Boolean(state.message)}
        onBlur={(event) => {
          if (event.currentTarget.value === lastSubmittedRef.current) return;
          // Commit the dedupe marker only after the server confirms success so
          // the same value can be retried after a transient failure.
          attemptedValueRef.current = event.currentTarget.value;
          formRef.current?.requestSubmit();
        }}
        className="h-7 w-full rounded border border-mw-line bg-mw-card px-2 text-right text-xs tabular-nums text-mw-fg outline-none focus:border-mw-record disabled:opacity-60"
        placeholder="—"
      />
      {state.message && !state.ok ? <span role="alert" className="absolute left-0 top-full z-10 mt-1 w-48 rounded border border-mw-error bg-mw-card p-2 text-[0.65rem] text-mw-error shadow-lg">{state.message}</span> : null}
    </form>
  );
}
