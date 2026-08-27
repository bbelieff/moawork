"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveNewLeadCreditScoresAction } from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import { BOARD_TABLE_CONTROL } from "./table-style";

function inputValue(value: CellValue | undefined): string | number {
  return typeof value === "number" || typeof value === "string" ? value : "";
}

export function NewLeadCreditScoresCell({
  boardId,
  itemId,
  ncb,
  kcb,
  readOnly,
}: {
  boardId: string;
  itemId: string;
  ncb: CellValue | undefined;
  kcb: CellValue | undefined;
  readOnly: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const ncbValue = inputValue(ncb);
  const kcbValue = inputValue(kcb);
  const savedRef = useRef(String(ncbValue) + "|" + String(kcbValue));
  const attemptedRef = useRef<string | null>(null);
  const [state, action, pending] = useActionState(saveNewLeadCreditScoresAction, { ok: false, message: "" });

  useEffect(() => {
    if (pending || !state.ok || attemptedRef.current === null) return;
    savedRef.current = attemptedRef.current;
    attemptedRef.current = null;
  }, [pending, state.ok, state.message]);

  if (readOnly) {
    return (
      <span className="grid grid-cols-2 gap-2 text-right text-xs tabular-nums text-mw-body">
        <span><span className="text-mw-sub">NCB</span> {ncbValue || "—"}</span>
        <span><span className="text-mw-sub">KCB</span> {kcbValue || "—"}</span>
      </span>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="relative grid grid-cols-2 gap-1"
      aria-label="신용점수"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        const data = new FormData(event.currentTarget);
        const snapshot = String(data.get("ncb") ?? "") + "|" + String(data.get("kcb") ?? "");
        if (snapshot === savedRef.current) return;
        attemptedRef.current = snapshot;
        event.currentTarget.requestSubmit();
      }}
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="itemId" value={itemId} />
      <label className="grid grid-cols-[auto_1fr] items-center gap-1 text-[0.65rem] text-mw-sub">
        NCB
        <input name="ncb" type="number" min={1} max={1000} step={1} defaultValue={ncbValue} disabled={pending} aria-label="NCB 신용점수" className={BOARD_TABLE_CONTROL + " text-right tabular-nums disabled:opacity-60"} placeholder="—" />
      </label>
      <label className="grid grid-cols-[auto_1fr] items-center gap-1 text-[0.65rem] text-mw-sub">
        KCB
        <input name="kcb" type="number" min={1} max={1000} step={1} defaultValue={kcbValue} disabled={pending} aria-label="KCB 신용점수" className={BOARD_TABLE_CONTROL + " text-right tabular-nums disabled:opacity-60"} placeholder="—" />
      </label>
      {state.message && !state.ok ? <span role="alert" className="absolute left-0 top-full z-10 mt-1 w-56 rounded border border-mw-error bg-mw-card p-2 text-[0.65rem] text-mw-error shadow-lg">{state.message}</span> : null}
    </form>
  );
}
