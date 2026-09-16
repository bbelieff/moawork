"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { createNewLeadAction } from "@/app/(app)/boards/new-lead-actions";
import { INITIAL_NEW_LEAD_INTAKE_STATE } from "@/lib/new-lead/intake-state";
import { BoardModalLayer } from "./BoardDialogPortal";
import {
  BusinessTypeField,
  PhoneField,
  RegionFields,
  RevenueBandField,
} from "./NewLeadIntakeFields";

type MemberOption = Readonly<{ id: string; label: string }>;

export function NewLeadIntakeForm({
  boardId, groupId, groups=[], members, currentUserId, variant = "inline",
}: {
  boardId: string;
  groupId: string;
  groups?:readonly {id:string;name:string}[];
  members: readonly MemberOption[];
  currentUserId?: string;
  variant?: "inline" | "header";
}) {
  const [state, action, pending] = useActionState(async (previous: typeof INITIAL_NEW_LEAD_INTAKE_STATE, data: FormData) => {
    try { return await createNewLeadAction(previous, data); }
    catch { return { ok: false, field: "form" as const, message: "서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 등록해 주세요. 입력한 내용은 유지됩니다." }; }
  }, INITIAL_NEW_LEAD_INTAKE_STATE);
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const [targetGroupId,setTargetGroupId]=useState(groupId);
  const titleRef = useRef<HTMLInputElement>(null);
  const headerOpenerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const restoreOpener = () => requestAnimationFrame(() => {
    headerOpenerRef.current?.focus();
  });

  function prepareOpen(): void {
    setDismissedMessage(null);
    setRequestId((current) => current || crypto.randomUUID());
    setOpen(true);
  }

  function closeEditor(reset = false): void {
    if (pending) return;
    if (reset) formRef.current?.reset();
    setDismissedMessage(state.message);
    setOpen(false);
    setRequestId("");
    restoreOpener();
  }

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);
  useEffect(() => {
    for (const field of formRef.current?.querySelectorAll<HTMLElement>("[aria-describedby]") ?? []) {
      if (field.getAttribute("aria-describedby") !== errorId) continue;
      field.removeAttribute("aria-describedby");
      field.setAttribute("aria-invalid", "false");
    }
    if (state.ok || !state.field || !open) return;
    const name = state.field === "revenue_band" ? "revenue_band_custom" : state.field;
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLElement) {
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", errorId);
      field.scrollIntoView({ block: "center", inline: "nearest" });
      field.focus();
    }
  }, [state, open, errorId]);
  useEffect(() => {
    if (!state.ok) return;
    const frame = requestAnimationFrame(() => {
      formRef.current?.reset();
      setRequestId("");
      setOpen(false);
      restoreOpener();
    });
    return () => cancelAnimationFrame(frame);
    // restoreOpener reads stable refs and the immutable variant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const intakeForm = (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      noValidate
      className="grid gap-3 bg-mw-card text-xs"
      aria-busy={pending}
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="groupId" value={targetGroupId} />
      <input type="hidden" name="requestId" value={requestId} />
      <fieldset disabled={pending} className="grid gap-2">
        <legend className="text-xs font-semibold text-mw-fg">기본 정보</legend>
        {variant==="header"&&groups.length>1?<label className="grid gap-1 text-xs font-medium text-mw-fg"><span>추가할 그룹</span><select value={targetGroupId} onChange={(event)=>setTargetGroupId(event.target.value)} className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5"><option value="" disabled>그룹 선택</option>{groups.map((group)=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>:null}
        <label className="grid gap-1 text-xs font-medium text-mw-fg">
          <span>회사명 <span aria-label="필수" className="font-semibold text-mw-error">*</span></span>
          <input ref={titleRef} name="title" aria-required="true" aria-invalid={state.field === "title"} className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs text-mw-fg outline-none focus:border-mw-record aria-[invalid=true]:border-mw-error" placeholder="회사명 또는 담당자 이름" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <BusinessTypeField invalid={state.field === "business_registration_type"} />
          <PhoneField invalid={state.field === "phone"} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-mw-sub">대표자명
            <input name="representative_name" className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub">이메일
            <input name="email" type="email" className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub">업종
            <input name="industry" className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs text-mw-fg" />
          </label>
          <RevenueBandField invalid={state.field === "revenue_band"} />
          <RegionFields invalidField={state.ok ? undefined : state.field} />
          <label className="grid gap-1 text-xs text-mw-sub sm:col-span-2">상세 주소
            <input name="address_detail" className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs text-mw-fg" />
          </label>
          <label className="grid gap-1 text-xs text-mw-sub sm:col-span-2">광고명
            <input name="acquisition_source" className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs text-mw-fg" />
          </label>
        </div>
      </fieldset>
      <fieldset disabled={pending} className="grid gap-2 border-t border-mw-line pt-2">
        <legend className="text-xs font-semibold text-mw-fg">담당자와 연관담당 <span className="font-normal text-mw-sub">선택</span></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid content-start gap-1 rounded-lg border border-mw-line p-2">
            <span className="text-xs font-semibold text-mw-body">담당자 1명</span>
            {members.map((member) => (
              <label key={member.id} className="flex min-h-8 items-center gap-2 text-xs text-mw-fg">
                <input type="radio" name="assigned_to" value={member.id} defaultChecked={member.id === currentUserId} />
                {member.label}{member.id === currentUserId ? " (나)" : ""}
              </label>
            ))}
          </div>
          <div className="grid content-start gap-1 rounded-lg border border-mw-line p-2">
            <span className="text-xs font-semibold text-mw-body">연관담당 · 알림받는 사람 여러 명</span>
            {members.map((member) => (
              <label key={member.id} className="flex min-h-8 items-center gap-2 text-xs text-mw-fg">
                <input type="checkbox" name="collaborator_ids" value={member.id} />
                {member.label}{member.id === currentUserId ? " (나)" : ""}
              </label>
            ))}
          </div>
        </div>
        <p className="text-[11px] leading-4 text-mw-sub">연관담당은 담당자와 함께 이 회사의 변경 알림을 받습니다.</p>
      </fieldset>
      <p className="text-[11px] leading-4 text-mw-sub">비워 둔 값은 등록 후 표와 회사 상세에서 수정할 수 있어요.</p>
      {state.message && !state.ok ? <p id={errorId} role="alert" className="rounded-md border border-mw-error p-2 text-sm text-mw-error">{state.message}</p> : null}
      <div className="flex gap-2">
        <button type="submit" onClick={() => setDismissedMessage(null)} disabled={pending} className="h-9 flex-1 rounded-lg bg-mw-primary text-xs font-semibold text-mw-on-accent disabled:opacity-60">{pending ? "등록 중…" : "등록"}</button>
        <button type="button" disabled={pending} onClick={() => closeEditor(true)} className="h-9 rounded-lg border border-mw-line px-3 text-xs text-mw-sub">취소</button>
      </div>
    </form>
  );

  return (
    <>
          <button ref={headerOpenerRef} type="button" onClick={prepareOpen} className={variant === "inline" ? "inline-flex min-h-11 items-center rounded-md px-2 text-xs text-mw-sub hover:bg-mw-bg hover:text-mw-fg" : "flex h-9 shrink-0 items-center rounded-md bg-mw-primary px-3.5 text-xs font-semibold text-mw-on-accent"}>
            {variant === "inline" ? "＋ 새 항목" : "＋ 새 회사"}
          </button>
          {open ? <BoardModalLayer label="새 회사 등록" dismissible={!pending} returnFocusRef={headerOpenerRef} onClose={() => closeEditor(false)}>
              <div className="w-[min(34rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--mw-radius)] border border-mw-line bg-mw-card p-4 shadow-xl">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-mw-fg">새 회사 등록</h2>
                  </div>
                  <button type="button" disabled={pending} aria-label="새 회사 등록 닫기" onClick={() => closeEditor(false)} className="rounded p-1 text-mw-sub hover:bg-mw-bg hover:text-mw-fg">✕</button>
                </div>
                {intakeForm}
              </div>
          </BoardModalLayer> : null}
      {state.message !== dismissedMessage && state.ok && state.message ? <p role="status" className="text-sm text-mw-success">{state.message}</p> : null}
    </>
  );
}
