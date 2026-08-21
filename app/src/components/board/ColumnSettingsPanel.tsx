"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
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

const DELIVERY_READY = false;

function policyMode(policy: Record<string, unknown> | undefined): "all" | "managers" {
  const roles = Array.isArray(policy?.roles) ? policy.roles : [];
  return roles.length === 2 && roles.includes("owner") && roles.includes("admin") ? "managers" : "all";
}

function statusLabel(status: ColumnScheduleRow["status"]): string {
  return { scheduled: "예약됨", claimed: "처리 중", fired: "완료", cancelled: "취소됨" }[status];
}

export function ColumnSettingsPanel({ boardId, column, items, recipients }: {
  boardId: string;
  column: BoardColumn;
  items: readonly ColumnScheduleItemOption[];
  recipients: readonly ColumnScheduleRecipientOption[];
}) {
  const isDate = column.type === "date" || column.type === "datetime";
  const isText = column.type === "text" || column.type === "longtext";
  const date = column.date_settings_jsonb ?? {};
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [schedules, setSchedules] = useState<ColumnScheduleRow[]>([]);
  const [recipientId, setRecipientId] = useState(recipients[0]?.id ?? "");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
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
      setPending(true);
      startTransition(async () => {
        const result = await saveColumnSettingsAction({
          boardId, columnId: column.id, requestId: crypto.randomUUID(),
          description: String(data.get("description") ?? ""),
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
      <fieldset disabled aria-describedby="required-backend-boundary" className="grid gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm opacity-80">
        <label><input type="checkbox" defaultChecked={column.is_required ?? false} /> 필수 항목</label>
        <label className="grid gap-1"><span>유효성 규칙</span><input defaultValue={JSON.stringify(column.validation_jsonb ?? {})} className="rounded border p-2" /></label>
        <p id="required-backend-boundary" className="text-xs text-amber-900">필수·유효성은 원자 저장과 서버 우회 차단 계약이 배포된 뒤 켤 수 있습니다. 현재 기존 값은 바꾸지 않습니다.</p>
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
      <button disabled={pending} className="rounded bg-mw-primary px-3 py-2 text-white disabled:opacity-50">{pending ? "저장 중…" : "설정 저장"}</button>
    </form>

    {isDate ? <section aria-label="날짜 알림 예약" className="grid gap-3 rounded border border-mw-line p-3 text-sm">
      <h3 className="font-semibold">알림·마감·리마인더 예약</h3>
      <p role="status" className="rounded bg-amber-50 p-2 text-xs text-amber-900">예약 장부는 준비됐지만 실제 발송 처리기가 아직 배포되지 않았습니다. 대상과 KST 시각을 확인할 수 있으며 새 예약은 연결 완료 전 저장되지 않습니다.</p>
      <label className="grid gap-1"><span>대상 아이템</span><select value={itemId} onChange={(event) => setItemId(event.target.value)} className="rounded border p-2"><option value="">선택</option>{items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="grid gap-1"><span>받는 사람(직접 선택)</span><select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} className="rounded border p-2"><option value="">선택</option>{recipients.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <p data-selected-recipient className="text-xs text-mw-sub">선택된 수신자: {recipient?.label ?? "없음"} — 담당자 자동 추정 없이 이 사용자 한 명에게만 예약합니다.</p>
      <label className="grid gap-1"><span>종류</span><select name="scheduleKind" className="rounded border p-2"><option value="notification">알림</option><option value="deadline">마감</option><option value="reminder">리마인더</option></select></label>
      <label className="grid gap-1"><span>예약 시각 (KST, Asia/Seoul)</span><input name="scheduledFor" type="datetime-local" className="rounded border p-2" /></label>
      <button type="button" disabled={!DELIVERY_READY || !itemId || !recipientId} onClick={() => {
        const root = document.activeElement?.closest("section");
        const time = root?.querySelector<HTMLInputElement>('[name="scheduledFor"]')?.value ?? "";
        const kind = (root?.querySelector<HTMLSelectElement>('[name="scheduleKind"]')?.value ?? "notification") as ColumnScheduleRow["kind"];
        const scheduledFor = kstLocalToIso(time);
        if (!scheduledFor) { setMessage({ ok: false, text: "KST 예약 시각을 확인해 주세요." }); return; }
        startTransition(async () => {
          const result = await setColumnScheduleAction({ boardId, columnId: column.id, itemId, targetUserId: recipientId, kind, scheduledFor, requestId: crypto.randomUUID() });
          setMessage({ ok: result.ok, text: result.message }); if (result.ok) reloadSchedules();
        });
      }} className="rounded border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">실제 발송 연결 후 예약 가능</button>
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
