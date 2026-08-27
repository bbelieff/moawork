"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveNewLeadFoundedDateAction } from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import { formatFoundedDate } from "@/lib/new-lead/financial-profile";
import { BOARD_TABLE_CONTROL } from "./table-style";

export function NewLeadFoundedDateCell({
  boardId,
  itemId,
  value,
  readOnly,
}: {
  boardId: string;
  itemId: string;
  value: CellValue | undefined;
  readOnly: boolean;
}) {
  const shown = typeof value === "string" ? value : "";
  const formRef = useRef<HTMLFormElement>(null);
  const savedRef = useRef(shown);
  const attemptedRef = useRef<string | null>(null);
  const [state, action, pending] = useActionState(saveNewLeadFoundedDateAction, { ok: false, message: "" });

  useEffect(() => {
    if (pending || !state.ok || attemptedRef.current === null) return;
    savedRef.current = attemptedRef.current;
    attemptedRef.current = null;
  }, [pending, state.ok, state.message]);

  if (readOnly) return <span className="block text-xs tabular-nums text-mw-body">{formatFoundedDate(value)}</span>;

  return (
    <form ref={formRef} action={action} className="relative">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input
        name="foundedDate"
        type="text"
        inputMode="numeric"
        pattern="\d{4}-(0[1-9]|1[0-2])(-([0-2]\d|3[01]))?"
        defaultValue={shown}
        disabled={pending}
        aria-label="창업연월"
        aria-describedby={state.message && !state.ok ? itemId + "-founded-date-error" : undefined}
        aria-invalid={!state.ok && Boolean(state.message)}
        placeholder="YYYY-MM 또는 YYYY-MM-DD"
        className={BOARD_TABLE_CONTROL + " tabular-nums disabled:opacity-60"}
        onBlur={(event) => {
          if (event.currentTarget.value === savedRef.current) return;
          attemptedRef.current = event.currentTarget.value;
          formRef.current?.requestSubmit();
        }}
      />
      {state.message && !state.ok ? <span id={itemId + "-founded-date-error"} role="alert" className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-mw-error bg-mw-card p-2 text-[0.65rem] text-mw-error shadow-lg">{state.message}</span> : null}
    </form>
  );
}
