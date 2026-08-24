"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createNewLeadAction } from "@/app/(app)/boards/new-lead-actions";
import { INITIAL_NEW_LEAD_INTAKE_STATE } from "@/lib/new-lead/intake-state";
import { NEW_LEAD_BUSINESS_TYPES } from "@/lib/new-lead/business-types";

type MemberOption = Readonly<{ id: string; label: string }>;

export function NewLeadIntakeForm({
  boardId, groupId, members, currentUserId,
}: {
  boardId: string;
  groupId: string;
  members: readonly MemberOption[];
  currentUserId?: string;
}) {
  const [state, action, pending] = useActionState(createNewLeadAction, INITIAL_NEW_LEAD_INTAKE_STATE);
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const businessTypeRef = useRef<HTMLSelectElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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
    if (!state.ok && state.field === "business_registration_type") {
      businessTypeRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
      businessTypeRef.current?.focus();
    }
  }, [state]);
  useEffect(() => {
    if (state.ok && detailsRef.current) { formRef.current?.reset(); setRequestId(""); detailsRef.current.open = false; summaryRef.current?.focus(); }
  }, [state]);

  return (
    <><details ref={detailsRef} onToggle={(event) => {
      const nextOpen = event.currentTarget.open;
      setOpen(nextOpen);
      if (nextOpen) setRequestId((current) => current || crypto.randomUUID());
    }} className="group/newlead">
      <summary ref={summaryRef} className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center rounded-lg px-2 text-xs text-mw-sub hover:bg-mw-bg hover:text-mw-fg">＋ 새 항목</summary>
      <form ref={formRef} action={action} noValidate className="mt-2 grid w-[min(32rem,calc(100vw-2rem))] gap-4 rounded-xl border border-mw-line bg-mw-card p-4 shadow-lg">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="requestId" value={requestId} />
      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-mw-fg">새 업체 빠르게 등록</legend>
      <label className="grid gap-1 text-sm font-medium text-mw-fg">
        업체명 <span className="text-mw-error">필수</span>
        <input ref={titleRef} name="title" aria-required="true" aria-invalid={state.field === "title"} className="h-11 rounded-lg border border-mw-line px-3 outline-none focus:border-mw-record aria-[invalid=true]:border-mw-error" placeholder="업체명을 입력하세요" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-mw-sub">사업자 구분 <span className="text-mw-error">필수</span>
          <select ref={businessTypeRef} name="business_registration_type" required aria-required="true" aria-invalid={state.field === "business_registration_type"} defaultValue="" className="h-11 rounded-lg border border-mw-line bg-mw-card px-2 text-mw-fg aria-[invalid=true]:border-mw-error">
            <option value="" disabled>선택하세요</option>
            {NEW_LEAD_BUSINESS_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-mw-sub">연락처 <span className="font-normal">선택</span>
          <input name="phone" inputMode="tel" className="h-11 rounded-lg border border-mw-line px-2 text-mw-fg" />
        </label>
      </div>
      </fieldset>
      <fieldset className="grid gap-3 border-t border-mw-line pt-3">
        <legend className="text-sm font-semibold text-mw-fg">담당자 <span className="font-normal text-mw-sub">선택</span></legend>
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs text-mw-sub">담당자
            <select name="assigned_to" defaultValue={currentUserId ?? ""} className="h-11 rounded-lg border border-mw-line bg-mw-card px-2 text-mw-fg">
              {members.map((member) => <option key={member.id} value={member.id}>{member.label}{member.id === currentUserId ? " (나)" : ""}</option>)}
            </select>
          </label>
        </div>
      </fieldset>
      <p className="text-xs text-mw-sub">먼저 등록한 뒤 상세 화면에서 대표자, 이메일, 지역, 협업자와 나머지 정보를 보완할 수 있어요.</p>
      {state.message ? <p role="alert" className={state.ok ? "text-sm text-mw-success" : "rounded-lg border border-mw-error p-2 text-sm text-mw-error"}>{state.message}</p> : null}
      <div className="flex gap-2">
        <button type="submit" onClick={() => setDismissedMessage(null)} disabled={pending} className="min-h-11 flex-1 rounded-lg bg-mw-primary font-semibold text-mw-on-accent disabled:opacity-60">{pending ? "등록 중…" : "등록"}</button>
        <button type="reset" onClick={() => { setDismissedMessage(state.message); if (detailsRef.current) detailsRef.current.open = false; summaryRef.current?.focus(); }} className="min-h-11 rounded-lg border border-mw-line px-4 text-sm text-mw-sub">취소</button>
      </div>
      </form>
    </details>{state.message !== dismissedMessage && state.ok && state.message ? <p role="status" className="text-sm text-mw-success">{state.message}</p> : null}</>
  );
}
