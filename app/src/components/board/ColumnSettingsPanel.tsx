"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { BoardColumn } from "@/lib/boards/types";
import {
  cancelColumnScheduleAction,
  loadColumnSchedulesAction,
  saveColumnSettingsAction,
  setColumnScheduleAction,
  type ColumnScheduleRow,
} from "@/app/(app)/boards/column-settings-actions";
import { kstLocalToIso } from "./column-settings-model";

export type ColumnScheduleItemOption = { id: string; label: string };
export type ColumnScheduleRecipientOption = { id: string; label: string };

const DELIVERY_READY = true;

function policyMode(policy: Record<string, unknown> | undefined): "all" | "managers" {
  const roles = Array.isArray(policy?.roles) ? policy.roles : [];
  return roles.length === 2 && roles.includes("owner") && roles.includes("admin") ? "managers" : "all";
}

function statusLabel(status: ColumnScheduleRow["status"]): string {
  return { scheduled: "예약됨", claimed: "처리 중", fired: "완료", cancelled: "취소됨" }[status];
}

export function ColumnSettingsPanel({ boardId, column, items, recipients, onRequestClose }: {
  boardId: string;
  column: BoardColumn;
  items: readonly ColumnScheduleItemOption[];
  recipients: readonly ColumnScheduleRecipientOption[];
  onRequestClose?: () => void;
}) {
  const isDate = column.type === "date" || column.type === "datetime";
  const isText = column.type === "text" || column.type === "longtext";
  const date = column.date_settings_jsonb ?? {};
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [schedules, setSchedules] = useState<ColumnScheduleRow[]>([]);
  const [recipientId, setRecipientId] = useState(recipients[0]?.id ?? "");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const scheduleRef = useRef<HTMLElement>(null);
  const recipient = useMemo(() => recipients.find((option) => option.id === recipientId), [recipientId, recipients]);

  const reloadSchedules = () => {
    if (!isDate) return;
    startTransition(async () => {
      const result = await loadColumnSchedulesAction(boardId, column.id);
      setMessage(result.ok ? null : { ok: false, text: result.message });
      if (result.schedules) setSchedules(result.schedules);
    });
  };
  useEffect(reloadSchedules, [boardId, column.id, isDate]);

  return <section aria-label={`${column.label} 컬럼 설정`} className="grid gap-4">
    <form className="grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const offset = Number(data.get("notificationOffsetMinutes") ?? 0);
      const reminders = String(data.get("reminderOffsetsMinutes") ?? "").split(",").map((part) => Number(part.trim())).filter((part) => Number.isFinite(part) && part >= 0);
      const validation: Record<string, unknown> = {};
      const setNumber = (key: string) => { const raw = String(data.get(key) ?? "").trim(); if (raw) validation[key] = Number(raw); };
      if (isText) { setNumber("minLength"); setNumber("maxLength"); const pattern = String(data.get("pattern") ?? "").trim(); if (pattern) validation.pattern = pattern; }
      if (column.type === "number" || column.type === "money") { setNumber("min"); setNumber("max"); }
      if (isDate) { const dateMin = String(data.get("dateMin") ?? ""); const dateMax = String(data.get("dateMax") ?? ""); if (dateMin) validation.dateMin = dateMin; if (dateMax) validation.dateMax = dateMax; }
      if (column.type === "select" || column.type === "multiselect" || column.type === "status") {
        const allowed = String(data.get("allowedValues") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
        if (allowed.length) validation.allowedValues = allowed;
      }
      setPending(true);
      startTransition(async () => {
        const result = await saveColumnSettingsAction({
          boardId, columnId: column.id, requestId: crypto.randomUUID(),
          description: String(data.get("description") ?? ""),
          required: data.get("required") === "on",
          validation,
          editPolicy: data.get("editPolicy") === "managers" ? "managers" : "all",
          viewPolicy: data.get("viewPolicy") === "managers" ? "managers" : "all",
          summaryHidden: data.get("summaryHidden") === "on",
          wrapMode: data.get("wrapMode") === "wrap" ? "wrap" : "single",
          ...(isDate ? { dateSettings: {
            includeTime: data.get("includeTime") === "on",
            displayFormat: (data.get("displayFormat") ?? "yyyy-MM-dd") as "yyyy-MM-dd" | "yyyy.MM.dd" | "MM/dd/yyyy",
            ...(Number.isFinite(offset) ? { notificationOffsetMinutes: offset } : {}),
            deadline: data.get("deadline") === "on", reminderOffsetsMinutes: reminders,
          } } : {}),
        });
        setMessage({ ok: result.ok, text: result.message }); setPending(false);
      });
    }}>
      <label className="grid gap-1 text-sm"><span>설명</span><textarea name="description" defaultValue={column.description ?? ""} className="rounded border border-mw-line bg-mw-card p-2" placeholder="헤더에서 함께 보여 줄 설명" /></label>
      <fieldset className="grid gap-2 rounded border border-mw-line p-3 text-sm">
        <legend className="px-1 font-semibold">필수·유효성</legend>
        <label><input name="required" type="checkbox" defaultChecked={column.is_required ?? false} /> 필수 항목</label>
        <p className="text-xs text-mw-sub">기존 결손은 임의로 채우지 않으며, 이후 저장과 새 아이템 생성부터 서버가 차단합니다.</p>
        {isText ? <div className="grid grid-cols-2 gap-2"><label className="grid gap-1"><span>최소 글자</span><input name="minLength" type="number" min="0" defaultValue={String(column.validation_jsonb?.minLength ?? "")} className="rounded border p-2" /></label><label className="grid gap-1"><span>최대 글자</span><input name="maxLength" type="number" min="0" defaultValue={String(column.validation_jsonb?.maxLength ?? "")} className="rounded border p-2" /></label><label className="col-span-2 grid gap-1"><span>패턴</span><input name="pattern" defaultValue={String(column.validation_jsonb?.pattern ?? "")} className="rounded border p-2" /></label></div> : null}
        {column.type === "number" || column.type === "money" ? <div className="grid grid-cols-2 gap-2"><label className="grid gap-1"><span>최솟값</span><input name="min" type="number" defaultValue={String(column.validation_jsonb?.min ?? "")} className="rounded border p-2" /></label><label className="grid gap-1"><span>최댓값</span><input name="max" type="number" defaultValue={String(column.validation_jsonb?.max ?? "")} className="rounded border p-2" /></label></div> : null}
        {isDate ? <div className="grid grid-cols-2 gap-2"><label className="grid gap-1"><span>시작일</span><input name="dateMin" type="date" defaultValue={String(column.validation_jsonb?.dateMin ?? "").slice(0, 10)} className="rounded border p-2" /></label><label className="grid gap-1"><span>종료일</span><input name="dateMax" type="date" defaultValue={String(column.validation_jsonb?.dateMax ?? "").slice(0, 10)} className="rounded border p-2" /></label></div> : null}
        {column.type === "select" || column.type === "multiselect" || column.type === "status" ? <label className="grid gap-1"><span>허용 값(쉼표 구분)</span><input name="allowedValues" defaultValue={Array.isArray(column.validation_jsonb?.allowedValues) ? column.validation_jsonb.allowedValues.join(", ") : ""} className="rounded border p-2" /></label> : null}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-sm"><span>편집 가능</span><select name="editPolicy" defaultValue={policyMode(column.edit_policy_jsonb)} className="rounded border p-2"><option value="all">모든 구성원</option><option value="managers">관리자만</option></select></label>
        <label className="grid gap-1 text-sm"><span>보기 가능</span><select name="viewPolicy" defaultValue={policyMode(column.view_policy_jsonb)} className="rounded border p-2"><option value="all">모든 구성원</option><option value="managers">관리자만</option></select></label>
      </div>
      <label className="text-sm"><input name="summaryHidden" type="checkbox" defaultChecked={column.summary_hidden ?? false} /> 컬럼 요약 숨기기</label>
      {isText ? <label className="grid gap-1 text-sm"><span>텍스트 표시</span><select name="wrapMode" defaultValue={column.wrap_mode ?? "single"} className="rounded border p-2"><option value="single">한 줄</option><option value="wrap">줄 바꿈</option></select></label> : <input type="hidden" name="wrapMode" value={column.wrap_mode ?? "single"} />}
      {isDate ? <fieldset className="grid gap-2 rounded border border-mw-line p-3 text-sm"><legend className="px-1 font-semibold">날짜 설정</legend>
        <label><input name="includeTime" type="checkbox" defaultChecked={date.includeTime ?? column.type === "datetime"} /> 시간 포함</label>
        <label className="grid gap-1"><span>표시 형식</span><select name="displayFormat" defaultValue={date.displayFormat ?? "yyyy-MM-dd"} className="rounded border p-2"><option value="yyyy-MM-dd">2026-08-21</option><option value="yyyy.MM.dd">2026.08.21</option><option value="MM/dd/yyyy">08/21/2026</option></select></label>
        <label className="grid gap-1"><span>알림 여유(분)</span><input name="notificationOffsetMinutes" type="number" min="0" max="525600" defaultValue={date.notificationOffsetMinutes ?? 0} className="rounded border p-2" /></label>
        <label><input name="deadline" type="checkbox" defaultChecked={date.deadline ?? false} /> 데드라인으로 표시</label>
        <label className="grid gap-1"><span>리마인더(분, 쉼표 구분)</span><input name="reminderOffsetsMinutes" defaultValue={(date.reminderOffsetsMinutes ?? []).join(", ")} className="rounded border p-2" /></label>
      </fieldset> : null}
      <button type="button" onClick={() => { onRequestClose?.(); window.requestAnimationFrame(() => { const library = document.getElementById("column-template-library"); library?.scrollIntoView({ behavior: "smooth", block: "center" }); (library as HTMLDetailsElement | null)?.setAttribute("open", ""); }); }} className="rounded border border-mw-line px-3 py-2 text-left text-sm">컬럼 템플릿 열기</button>
      <button disabled={pending} className="rounded bg-mw-primary px-3 py-2 text-white disabled:opacity-50">{pending ? "저장 중…" : "설정 저장"}</button>
    </form>

    {isDate ? <section ref={scheduleRef} aria-label="날짜 알림 예약" className="grid gap-3 rounded border border-mw-line p-3 text-sm">
      <h3 className="font-semibold">알림·마감·리마인더 예약</h3>
      <p role="status" className="rounded bg-mw-tint-blue p-2 text-xs text-mw-body">예약은 현재 알림센터로 전달됩니다. 외부 문자·이메일은 보내지 않습니다. 처리 권한이나 연결 상태가 불확실하면 저장하지 않고 오류를 표시합니다.</p>
      <label className="grid gap-1"><span>대상 아이템</span><select value={itemId} onChange={(event) => setItemId(event.target.value)} className="rounded border p-2"><option value="">선택</option>{items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="grid gap-1"><span>받는 사람(직접 선택)</span><select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} className="rounded border p-2"><option value="">선택</option>{recipients.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <p data-selected-recipient className="text-xs text-mw-sub">선택된 수신자: {recipient?.label ?? "없음"} — 담당자 자동 추정 없이 이 사용자 한 명에게만 예약합니다.</p>
      <label className="grid gap-1"><span>종류</span><select name="scheduleKind" className="rounded border p-2"><option value="notification">알림</option><option value="deadline">마감</option><option value="reminder">리마인더</option></select></label>
      <label className="grid gap-1"><span>예약 시각 (KST, Asia/Seoul)</span><input name="scheduledFor" type="datetime-local" className="rounded border p-2" /></label>
      <button type="button" disabled={!DELIVERY_READY || !itemId || !recipientId} onClick={() => {
        const root = scheduleRef.current;
        const time = root?.querySelector<HTMLInputElement>('[name="scheduledFor"]')?.value ?? "";
        const kind = (root?.querySelector<HTMLSelectElement>('[name="scheduleKind"]')?.value ?? "notification") as ColumnScheduleRow["kind"];
        const scheduledFor = kstLocalToIso(time);
        if (!scheduledFor) { setMessage({ ok: false, text: "KST 예약 시각을 확인해 주세요." }); return; }
        startTransition(async () => {
          const result = await setColumnScheduleAction({ boardId, columnId: column.id, itemId, targetUserId: recipientId, kind, scheduledFor, requestId: crypto.randomUUID() });
          setMessage({ ok: result.ok, text: result.message }); if (result.ok) reloadSchedules();
        });
      }} className="rounded border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">예약 저장</button>
      <ul className="grid gap-2">{schedules.map((schedule) => <li key={schedule.id} className="flex items-center justify-between gap-2 rounded bg-mw-bg p-2">
        <span>{statusLabel(schedule.status)} · {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(schedule.scheduledFor))} KST</span>
        {schedule.status === "scheduled" ? <button type="button" className="rounded border px-2 py-1" onClick={() => startTransition(async () => {
          const result = await cancelColumnScheduleAction(boardId, column.id, schedule.id, crypto.randomUUID());
          setMessage({ ok: result.ok, text: result.message }); if (result.ok) reloadSchedules();
        })}>취소</button> : null}
      </li>)}</ul>
    </section> : null}
    {message ? <p role={message.ok ? "status" : "alert"} className={`rounded p-2 text-sm ${message.ok ? "bg-mw-tint-blue" : "bg-red-50 text-red-700"}`}>{message.text}</p> : null}
  </section>;
}
