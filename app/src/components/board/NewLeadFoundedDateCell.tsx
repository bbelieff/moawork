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
}: {
  boardId: string;
  itemId: string;
  value: CellValue | undefined;
  readOnly: boolean;
  saveAction?: (
    previous: SaveNewLeadFinancialState,
    formData: FormData,
  ) => Promise<SaveNewLeadFinancialState>;
}) {
  const shown = typeof value === "string" ? value : "";
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
        value={draft}
        disabled={pending}
        aria-label="창업연월"
        aria-describedby={state.message && !state.ok ? itemId + "-founded-date-error" : undefined}
        aria-invalid={!state.ok && Boolean(state.message)}
        placeholder="YYYY-MM 또는 YYYY-MM-DD"
        className={BOARD_TABLE_CONTROL + " tabular-nums disabled:opacity-60"}
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
      {state.message && !state.ok ? <span id={itemId + "-founded-date-error"} role="alert" className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-mw-error bg-mw-card p-2 text-[0.65rem] text-mw-error shadow-lg">{state.message}</span> : null}
    </form>
  );
}
