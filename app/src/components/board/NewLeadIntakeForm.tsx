"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createNewLeadAction } from "@/app/(app)/boards/new-lead-actions";
import { INITIAL_NEW_LEAD_INTAKE_STATE } from "@/lib/new-lead/intake-state";

export function NewLeadIntakeForm({ boardId, groupId }: { boardId: string; groupId: string }) {
  const [state, action, pending] = useActionState(createNewLeadAction, INITIAL_NEW_LEAD_INTAKE_STATE);
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!state.ok && state.field === "title") {
      titleRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
      titleRef.current?.focus();
    }
  }, [state]);
  useEffect(() => {
    if (state.ok && detailsRef.current) detailsRef.current.open = false;
  }, [state.ok]);

  return (
    <details ref={detailsRef} onToggle={(event) => setOpen(event.currentTarget.open)} className="group/newlead">
      <summary className="w-fit cursor-pointer list-none rounded-lg px-2 py-1 text-xs text-mw-sub hover:bg-mw-bg hover:text-mw-fg">＋ 새 항목</summary>
      <form action={action} noValidate className="mt-2 grid w-[min(34rem,calc(100vw-2rem))] gap-3 rounded-xl border border-mw-line bg-mw-card p-4 shadow-lg">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="groupId" value={groupId} />
      <label className="grid gap-1 text-sm font-medium text-mw-fg">
        이름 <span className="text-mw-error">필수</span>
        <input ref={titleRef} name="title" aria-required="true" aria-invalid={state.field === "title"} className="h-10 rounded-lg border border-mw-line px-3 outline-none focus:border-mw-record aria-[invalid=true]:border-mw-error" placeholder="업체명 또는 담당자 이름" />
      </label>
      <p className="text-xs text-mw-sub">이름만 입력해도 등록됩니다. 나머지는 지금 또는 등록 후 언제든 수정할 수 있어요.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-mw-sub">연락처<input name="phone" inputMode="tel" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">대표자<input name="representative_name" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">이메일<input name="email" type="email" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">업종<input name="industry" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">시도<input name="region_sido" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">광고 출처<input name="acquisition_source" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
      </div>
      {state.message ? <p role="alert" className={state.ok ? "text-sm text-mw-success" : "rounded-lg border border-mw-error p-2 text-sm text-mw-error"}>{state.message}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="h-10 flex-1 rounded-lg bg-mw-primary font-semibold text-mw-on-accent disabled:opacity-60">{pending ? "등록 중…" : "등록"}</button>
        <button type="reset" onClick={() => { if (detailsRef.current) detailsRef.current.open = false; }} className="h-10 rounded-lg border border-mw-line px-4 text-sm text-mw-sub">취소</button>
      </div>
      </form>
    </details>
  );
}
