"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveNewLeadCreditScoreAction,
  type SaveNewLeadFinancialState,
} from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import { CREDIT_SCORE_KEYS } from "@/lib/new-lead/financial-profile";
import { BOARD_TABLE_CONTROL } from "./table-style";

type SaveCreditScoreAction = (
  previous: SaveNewLeadFinancialState,
  formData: FormData,
) => Promise<SaveNewLeadFinancialState>;

function durableText(value: CellValue | undefined): string {
  return typeof value === "number" || typeof value === "string" ? String(value) : "";
}

function CreditScoreEditor({
  boardId,
  itemId,
  fieldKey,
  label,
  value,
  saveAction,
}: {
  boardId: string;
  itemId: string;
  fieldKey: string;
  label: "NCB" | "KCB";
  value: CellValue | undefined;
  saveAction: SaveCreditScoreAction;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const external = durableText(value);
  const externalRef = useRef(external);
  const attemptedRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const [draft, setDraft] = useState(external);
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState(saveAction, { ok: false, message: "" });

  useEffect(() => {
    if (external === externalRef.current) return;
    externalRef.current = external;
    if (!dirtyRef.current) setDraft(external);
  }, [external]);

  useEffect(() => {
    if (pending || attemptedRef.current === null || !state.ok) return;
    externalRef.current = attemptedRef.current;
    attemptedRef.current = null;
    dirtyRef.current = false;
    setDirty(false);
  }, [pending, state.ok, state.message]);

  return (
    <form ref={formRef} action={action} className="relative">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="fieldKey" value={fieldKey} />
      <label className="grid grid-cols-[auto_1fr] items-center gap-1 text-[0.65rem] text-mw-sub">
        {label}
        <input
          name="score"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          disabled={pending}
          aria-label={`${label} 신용점수`}
          aria-invalid={!state.ok && Boolean(state.message)}
          className={BOARD_TABLE_CONTROL + " text-right tabular-nums disabled:opacity-60"}
          placeholder="—"
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
      </label>
      {state.message && !state.ok ? <span role="alert" className="absolute left-0 top-full z-10 mt-1 w-48 rounded border border-mw-error bg-mw-card p-2 text-[0.65rem] text-mw-error shadow-lg">{state.message}</span> : null}
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
}: {
  boardId: string;
  itemId: string;
  ncb: CellValue | undefined;
  kcb: CellValue | undefined;
  readOnly: boolean;
  saveAction?: SaveCreditScoreAction;
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
      <CreditScoreEditor boardId={boardId} itemId={itemId} fieldKey={CREDIT_SCORE_KEYS.ncb} label="NCB" value={ncb} saveAction={saveAction} />
      <CreditScoreEditor boardId={boardId} itemId={itemId} fieldKey={CREDIT_SCORE_KEYS.kcb} label="KCB" value={kcb} saveAction={saveAction} />
    </div>
  );
}
