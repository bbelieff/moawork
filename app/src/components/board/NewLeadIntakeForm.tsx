"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createNewLeadAction } from "@/app/(app)/boards/new-lead-actions";
import { INITIAL_NEW_LEAD_INTAKE_STATE } from "@/lib/new-lead/intake-state";

type MemberOption = Readonly<{ id: string; label: string }>;

const SYSTEM_INITIAL_VALUES = [
  ["신청일", "오늘(KST)"], ["컨택 이동", "신규리드 · 컨택 대기"], ["상담 상황", "미상담 · 상담 전"],
  ["부재 안내", "해당 없음"], ["1차 상담 안내", "해당 없음"], ["2차 확정 안내", "해당 없음"],
  ["피드백 상황", "미입력"], ["재통화 일시", "일정 없음"], ["대면미팅 일시", "일정 없음"],
  ["재접촉일", "일정 없음"], ["계약금", "미정"], ["파일", "등록 후 첨부"],
] as const;

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
    if (state.ok && detailsRef.current) { formRef.current?.reset(); setRequestId(""); detailsRef.current.open = false; summaryRef.current?.focus(); }
  }, [state]);

  return (
    <><details ref={detailsRef} onToggle={(event) => {
      const nextOpen = event.currentTarget.open;
      setOpen(nextOpen);
      if (nextOpen) setRequestId((current) => current || crypto.randomUUID());
    }} className="group/newlead">
      <summary ref={summaryRef} className="w-fit cursor-pointer list-none rounded-lg px-2 py-1 text-xs text-mw-sub hover:bg-mw-bg hover:text-mw-fg">＋ 새 항목</summary>
      <form ref={formRef} action={action} noValidate className="mt-2 grid w-[min(52rem,calc(100vw-2rem))] gap-4 rounded-xl border border-mw-line bg-mw-card p-4 shadow-lg">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="requestId" value={requestId} />
      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-mw-fg">회사와 신청 정보</legend>
      <label className="grid gap-1 text-sm font-medium text-mw-fg">
        회사명 / 이름 <span className="text-mw-error">필수</span>
        <input ref={titleRef} name="title" aria-required="true" aria-invalid={state.field === "title"} className="h-10 rounded-lg border border-mw-line px-3 outline-none focus:border-mw-record aria-[invalid=true]:border-mw-error" placeholder="업체명 또는 담당자 이름" />
      </label>
      <p className="text-xs text-mw-sub">확인된 사실만 입력하세요. 비워 둔 값은 저장 시 임의로 채우지 않고 «미정»으로 표시되며, 등록 후에도 수정할 수 있습니다.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-mw-sub">연락처<input name="phone" inputMode="tel" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">대표자<input name="representative_name" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">이메일<input name="email" type="email" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">사업자 유형<input name="business_registration_type" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" placeholder="예: 개인사업자" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">업종·업태<input name="industry" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">매출 / 매출 구간<input name="revenue_band" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" placeholder="확인된 값만 입력" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">광고명 / 유입경로<input name="acquisition_source" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">시도<input name="region_sido" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub">시군구<input name="region_sigungu" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
        <label className="grid gap-1 text-xs text-mw-sub sm:col-span-2">상세 주소<input name="address_detail" className="h-9 rounded-lg border border-mw-line px-2 text-mw-fg" /></label>
      </div>
      </fieldset>
      <fieldset className="grid gap-3 border-t border-mw-line pt-3">
        <legend className="text-sm font-semibold text-mw-fg">담당과 협업</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-mw-sub">담당자
            <select name="assigned_to" defaultValue={currentUserId ?? ""} className="h-9 rounded-lg border border-mw-line bg-mw-card px-2 text-mw-fg">
              {members.map((member) => <option key={member.id} value={member.id}>{member.label}{member.id === currentUserId ? " (나)" : ""}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-mw-sub">협업자 <span className="font-normal">선택</span>
            <select name="collaborator_ids" multiple className="min-h-20 rounded-lg border border-mw-line bg-mw-card px-2 py-1 text-mw-fg">
              {members.filter((member) => member.id !== currentUserId).map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
            </select>
          </label>
        </div>
      </fieldset>
      <fieldset className="border-t border-mw-line pt-3">
        <legend className="text-sm font-semibold text-mw-fg">등록과 동시에 준비되는 값</legend>
        <p className="mt-1 text-xs text-mw-sub">자동값도 등록 후 권한이 있는 사용자가 계속 수정할 수 있습니다.</p>
        <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {SYSTEM_INITIAL_VALUES.map(([label, value]) => <div key={label} className="rounded-lg bg-mw-bg px-2 py-1.5"><dt className="text-[0.68rem] text-mw-sub">{label}</dt><dd className="text-xs font-medium text-mw-body">{value}</dd></div>)}
        </dl>
      </fieldset>
      {state.message ? <p role="alert" className={state.ok ? "text-sm text-mw-success" : "rounded-lg border border-mw-error p-2 text-sm text-mw-error"}>{state.message}</p> : null}
      <div className="flex gap-2">
        <button type="submit" onClick={() => setDismissedMessage(null)} disabled={pending} className="h-10 flex-1 rounded-lg bg-mw-primary font-semibold text-mw-on-accent disabled:opacity-60">{pending ? "등록 중…" : "등록"}</button>
        <button type="reset" onClick={() => { setDismissedMessage(state.message); if (detailsRef.current) detailsRef.current.open = false; summaryRef.current?.focus(); }} className="h-10 rounded-lg border border-mw-line px-4 text-sm text-mw-sub">취소</button>
      </div>
      </form>
    </details>{state.message !== dismissedMessage && state.ok && state.message ? <p role="status" className="text-sm text-mw-success">{state.message}</p> : null}</>
  );
}
