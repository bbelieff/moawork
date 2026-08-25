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
        <legend className="text-sm font-semibold text-mw-fg">기본 정보</legend>
        <label className="grid gap-1 text-sm font-medium text-mw-fg">
          회사명 <span className="text-mw-error">필수</span>
          <input ref={titleRef} name="title" aria-required="true" aria-invalid={state.field === "title"} className="h-11 rounded-lg border border-mw-line px-3 outline-none focus:border-mw-record aria-[invalid=true]:border-mw-error" placeholder="회사명 또는 담당자 이름" />
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-mw-sub">대표자명
            <input name="representative_name" className="h-11 rounded-lg border border-mw-line px-2 text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub">이메일
            <input name="email" type="email" className="h-11 rounded-lg border border-mw-line px-2 text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub">업종/업태
            <input name="industry" className="h-11 rounded-lg border border-mw-line px-2 text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub">매출 구간
            <input name="revenue_band" className="h-11 rounded-lg border border-mw-line px-2 text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub">시도
            <input name="region_sido" className="h-11 rounded-lg border border-mw-line px-2 text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub">시군구
            <input name="region_sigungu" className="h-11 rounded-lg border border-mw-line px-2 text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub sm:col-span-2">상세 주소
            <input name="address_detail" className="h-11 rounded-lg border border-mw-line px-2 text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub sm:col-span-2">광고 명
            <input name="acquisition_source" className="h-11 rounded-lg border border-mw-line px-2 text-mw-fg" />
          </label>
        </div>
      </fieldset>
      <fieldset className="grid gap-3 border-t border-mw-line pt-3">
        <legend className="text-sm font-semibold text-mw-fg">함께 일할 사람 <span className="font-normal text-mw-sub">선택</span></legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid content-start gap-2 rounded-lg border border-mw-line p-3">
            <span className="text-xs font-semibold text-mw-body">담당자 1명</span>
            {members.map((member) => (
              <label key={member.id} className="flex min-h-9 items-center gap-2 text-sm text-mw-fg">
                <input type="radio" name="assigned_to" value={member.id} defaultChecked={member.id === currentUserId} />
                {member.label}{member.id === currentUserId ? " (나)" : ""}
              </label>
            ))}
          </div>
          <div className="grid content-start gap-2 rounded-lg border border-mw-line p-3">
            <span className="text-xs font-semibold text-mw-body">협업자 여러 명</span>
            {members.map((member) => (
              <label key={member.id} className="flex min-h-9 items-center gap-2 text-sm text-mw-fg">
                <input type="checkbox" name="collaborator_ids" value={member.id} />
                {member.label}{member.id === currentUserId ? " (나)" : ""}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
      <p className="text-xs leading-5 text-mw-sub">여기서 비워 둔 값도 등록 후 표와 회사 상세에서 언제든 수정할 수 있어요.</p>
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
            ＋ 새 회사
          </button>
          {open ? <BoardModalLayer label="새 회사 등록" onClose={() => closeEditor(false)}>
              <div className="w-[min(34rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--mw-radius)] border border-mw-line bg-mw-card p-5 shadow-xl">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-mw-fg">새 회사 등록</h2>
                    <p className="mt-1 text-xs text-mw-sub">보드에서 바로 쓸 정보를 한 번에 입력할 수 있어요.</p>
                  </div>
                  <button type="button" aria-label="새 회사 등록 닫기" onClick={() => closeEditor(false)} className="rounded p-1 text-mw-sub hover:bg-mw-bg hover:text-mw-fg">✕</button>
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
