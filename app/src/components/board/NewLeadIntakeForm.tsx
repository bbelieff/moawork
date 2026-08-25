"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createNewLeadAction } from "@/app/(app)/boards/new-lead-actions";
import { INITIAL_NEW_LEAD_INTAKE_STATE } from "@/lib/new-lead/intake-state";
import { NEW_LEAD_BUSINESS_TYPES } from "@/lib/new-lead/business-types";
import { BoardModalLayer } from "./BoardDialogPortal";

type MemberOption = Readonly<{ id: string; label: string }>;

export function NewLeadIntakeForm({
  boardId, groupId, members, currentUserId, variant = "inline",
}: {
  boardId: string;
  groupId: string;
  members: readonly MemberOption[];
  currentUserId?: string;
  variant?: "inline" | "header";
}) {
  const [state, action, pending] = useActionState(createNewLeadAction, INITIAL_NEW_LEAD_INTAKE_STATE);
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const businessTypeRef = useRef<HTMLSelectElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const headerOpenerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const restoreOpener = () => requestAnimationFrame(() => {
    if (variant === "header") headerOpenerRef.current?.focus();
    else summaryRef.current?.focus();
  });

  function prepareOpen(): void {
    setDismissedMessage(null);
    setRequestId((current) => current || crypto.randomUUID());
    setOpen(true);
  }

  function closeEditor(reset = false): void {
    if (reset) formRef.current?.reset();
    setDismissedMessage(state.message);
    setOpen(false);
    setRequestId("");
    if (detailsRef.current) detailsRef.current.open = false;
    restoreOpener();
  }

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
    if (!state.ok) return;
    const frame = requestAnimationFrame(() => {
      formRef.current?.reset();
      setRequestId("");
      setOpen(false);
      if (detailsRef.current) detailsRef.current.open = false;
      restoreOpener();
    });
    return () => cancelAnimationFrame(frame);
    // restoreOpener reads stable refs and the immutable variant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  const intakeForm = (
    <form
      ref={formRef}
      action={action}
      noValidate
      className={`grid gap-4 bg-mw-card ${variant === "inline" ? "mt-2 w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-mw-line p-4 shadow-lg" : ""}`}
    >
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
        <label className="grid gap-1 text-xs text-mw-sub">담당자
          <select name="assigned_to" defaultValue={currentUserId ?? ""} className="h-11 rounded-lg border border-mw-line bg-mw-card px-2 text-mw-fg">
            {members.map((member) => <option key={member.id} value={member.id}>{member.label}{member.id === currentUserId ? " (나)" : ""}</option>)}
          </select>
        </label>
      </fieldset>
      <p className="text-xs leading-5 text-mw-sub">먼저 등록한 뒤 상세 화면에서 대표자, 이메일, 지역, 협업자와 나머지 정보를 보완할 수 있어요.</p>
      {state.message ? <p role="alert" className={state.ok ? "text-sm text-mw-success" : "rounded-lg border border-mw-error p-2 text-sm text-mw-error"}>{state.message}</p> : null}
      <div className="flex gap-2">
        <button type="submit" onClick={() => setDismissedMessage(null)} disabled={pending} className="min-h-11 flex-1 rounded-lg bg-mw-primary font-semibold text-mw-on-accent disabled:opacity-60">{pending ? "등록 중…" : "등록"}</button>
        <button type="button" onClick={() => closeEditor(true)} className="min-h-11 rounded-lg border border-mw-line px-4 text-sm text-mw-sub">취소</button>
      </div>
    </form>
  );

  return (
    <>
      {variant === "inline" ? (
        <details
          ref={detailsRef}
          onToggle={(event) => {
            const nextOpen = event.currentTarget.open;
            setOpen(nextOpen);
            if (nextOpen) prepareOpen();
          }}
          className="group/newlead"
        >
          <summary ref={summaryRef} className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center rounded-lg px-2 text-xs text-mw-sub hover:bg-mw-bg hover:text-mw-fg">＋ 새 항목</summary>
          {intakeForm}
        </details>
      ) : (
        <>
          <button ref={headerOpenerRef} type="button" onClick={prepareOpen} className="flex h-9 shrink-0 items-center rounded-full bg-mw-primary px-3.5 text-xs font-semibold text-mw-on-accent">
            ＋ 새 업체
          </button>
          {open ? <BoardModalLayer label="새 업체 등록" onClose={() => closeEditor(false)}>
              <div className="w-[min(34rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--mw-radius)] border border-mw-line bg-mw-card p-5 shadow-xl">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-mw-fg">새 업체 등록</h2>
                    <p className="mt-1 text-xs text-mw-sub">필수 두 칸만 먼저 쓰고 바로 상담을 시작할 수 있어요.</p>
                  </div>
                  <button type="button" aria-label="새 업체 등록 닫기" onClick={() => closeEditor(false)} className="rounded p-1 text-mw-sub hover:bg-mw-bg hover:text-mw-fg">✕</button>
                </div>
                {intakeForm}
              </div>
          </BoardModalLayer> : null}
        </>
      )}
      {state.message !== dismissedMessage && state.ok && state.message ? <p role="status" className="text-sm text-mw-success">{state.message}</p> : null}
    </>
  );
}
