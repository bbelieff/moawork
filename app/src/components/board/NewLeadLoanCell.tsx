"use client";

import { useActionState, useState } from "react";
import {
  saveNewLeadLoanProfileAction,
} from "@/app/(app)/boards/new-lead-actions";
import type { CellValue } from "@/lib/boards/types";
import {
  existingLoanProfileFromValues,
  existingLoanSummary,
} from "@/lib/new-lead/financial-profile";
import { BoardModalLayer } from "./BoardDialogPortal";

const CONTROL = "h-9 w-full rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs text-mw-fg outline-none focus:border-mw-record";

export function NewLeadLoanCell({
  boardId,
  itemId,
  values,
  readOnly,
}: {
  boardId: string;
  itemId: string;
  values: Readonly<Record<string, CellValue | undefined>>;
  readOnly: boolean;
}) {
  const profile = existingLoanProfileFromValues(values);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    saveNewLeadLoanProfileAction,
    { ok: false, message: "" },
  );

  if (readOnly) {
    return <span className="block truncate text-xs text-mw-body">{existingLoanSummary(profile)}</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-7 w-full truncate rounded border border-mw-line bg-mw-card px-2 text-left text-xs text-mw-fg hover:border-mw-record"
        aria-label={`기대출 편집: ${existingLoanSummary(profile)}`}
      >
        {existingLoanSummary(profile)}
      </button>
      {open ? (
        <BoardModalLayer label="기대출 편집" onClose={() => setOpen(false)}>
          <form action={action} className="w-[min(36rem,calc(100vw-1.5rem))] rounded-xl border border-mw-line bg-mw-card p-4 shadow-xl">
            <input type="hidden" name="boardId" value={boardId} />
            <input type="hidden" name="itemId" value={itemId} />
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-mw-fg">기대출</h2>
                <p className="mt-1 text-xs text-mw-sub">대출 한 건의 진행기관·시점·금액·금리·조건을 함께 기록합니다.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="기대출 편집 닫기" className="rounded p-1 text-mw-sub hover:bg-mw-bg">✕</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs text-mw-sub">진행기관
                <input name="loanProvider" defaultValue={profile.provider} className={CONTROL} placeholder="예: 기업은행" />
              </label>
              <label className="grid gap-1 text-xs text-mw-sub">대출연월
                <input name="loanMonth" type="month" defaultValue={profile.month} className={CONTROL} />
              </label>
              <label className="grid gap-1 text-xs text-mw-sub">금액
                <input name="loanAmount" inputMode="numeric" defaultValue={profile.amount ?? ""} className={CONTROL} placeholder="원 단위" />
              </label>
              <label className="grid gap-1 text-xs text-mw-sub">금리
                <div className="relative"><input name="loanRate" inputMode="decimal" defaultValue={profile.rate ?? ""} className={`${CONTROL} pr-7`} placeholder="0.0" /><span className="pointer-events-none absolute right-2.5 top-2.5 text-xs text-mw-sub">%</span></div>
              </label>
              <label className="grid gap-1 text-xs text-mw-sub sm:col-span-2">조건
                <input name="loanTerms" defaultValue={profile.terms} className={CONTROL} placeholder="예: 만기일시상환, 보증서 90%" />
              </label>
              <label className="grid gap-1 text-xs text-mw-sub sm:col-span-2">비고
                <textarea name="loanNotes" defaultValue={profile.notes} rows={3} className="w-full resize-y rounded-lg border border-mw-line bg-mw-card px-2.5 py-2 text-xs text-mw-fg outline-none focus:border-mw-record" />
              </label>
            </div>
            {state.message ? <p role="status" className={`mt-3 text-xs ${state.ok ? "text-mw-success" : "text-mw-error"}`}>{state.message}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg border border-mw-line bg-mw-card px-3 text-xs text-mw-sub">취소</button>
              <button type="submit" disabled={pending} className="h-9 rounded-lg bg-mw-primary px-4 text-xs font-semibold text-mw-on-accent disabled:opacity-60">{pending ? "저장 중…" : "저장"}</button>
            </div>
          </form>
        </BoardModalLayer>
      ) : null}
    </>
  );
}
