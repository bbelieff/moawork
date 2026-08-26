"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ItemWithValues } from "@/lib/boards/types";
import { formatPhone } from "@/lib/format/phone";
import { BoardModalLayer } from "./BoardDialogPortal";

const MESSAGE_TEMPLATES = [
  { id: "delay", label: "상담지연", body: "안녕하세요. 상담 일정이 지연되어 안내드립니다. 담당자가 확인 후 다시 연락드리겠습니다." },
  { id: "absence", label: "간편 부재", body: "안녕하세요. 상담을 위해 연락드렸으나 연결되지 않아 안내드립니다. 확인 후 연락 부탁드립니다." },
  { id: "malicious-absence", label: "악성 부재", body: "여러 차례 연락드렸으나 연결되지 않아 상담 진행이 보류됩니다. 계속 진행을 원하시면 회신해 주세요." },
  { id: "consult-1", label: "1차 상담 안내", body: "1차 상담 내용을 확인했습니다. 다음 진행 사항은 담당자가 이어서 안내드리겠습니다." },
  { id: "confirm-2", label: "2차 확정 안내", body: "2차 상담 일정이 확정되었습니다. 담당자가 확정 내용을 다시 안내드리겠습니다." },
] as const;

const MESSAGE_VALUE_KEYS = [
  "delay_notice", "absence_notice", "malicious_absence_notice",
  "consult1_notice", "confirm2_notice",
] as const;

function lastMessageStatus(row: ItemWithValues): string {
  for (const key of MESSAGE_VALUE_KEYS) {
    const value = row.values[key];
    if (typeof value === "string" && value.trim() && !["보내기 전", "심사 전"].includes(value)) return value;
  }
  return "발송 전";
}

export function NewLeadMessageCell({ row }: { row: ItemWithValues }) {
  const [templateId, setTemplateId] = useState<(typeof MESSAGE_TEMPLATES)[number]["id"]>("delay");
  const [open, setOpen] = useState(false);
  const template = useMemo(
    () => MESSAGE_TEMPLATES.find((entry) => entry.id === templateId) ?? MESSAGE_TEMPLATES[0],
    [templateId],
  );
  const phone = formatPhone(typeof row.values.phone === "string" ? row.values.phone : "");
  const recipient = phone && phone !== "확인 필요" ? phone : "연락처 확인 필요";
  const ready = false;

  return (
    <div className="flex min-w-72 items-center gap-1.5 px-1">
      <select
        aria-label="메시지 종류"
        value={templateId}
        onChange={(event) => setTemplateId(event.target.value as typeof templateId)}
        className="h-8 min-w-32 flex-1 rounded-md border border-mw-line bg-mw-card px-2 text-xs text-mw-fg"
      >
        {MESSAGE_TEMPLATES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
      <button type="button" onClick={() => setOpen(true)} className="h-8 rounded-md bg-mw-primary px-3 text-xs font-semibold text-mw-on-accent">
        보내기
      </button>
      <Link href="/settings/automations#solapi" className="grid h-8 w-8 place-items-center rounded-md border border-mw-line text-mw-sub" aria-label="메시지 발송 설정">⚙</Link>
      <span className="min-w-16 text-[0.65rem] text-mw-sub">{lastMessageStatus(row)}</span>

      {open ? (
        <BoardModalLayer label="메시지 발송 확인" onClose={() => setOpen(false)}>
          <section className="w-[min(30rem,calc(100vw-1.5rem))] rounded-2xl border border-mw-line bg-mw-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-mw-record">{template.label}</p>
                <h2 className="mt-1 text-lg font-bold text-mw-fg">이대로 보내시겠습니까?</h2>
                <p className="mt-1 text-xs text-mw-sub">받는 사람 · {recipient}</p>
              </div>
              <button type="button" aria-label="발송 확인 닫기" onClick={() => setOpen(false)} className="rounded-md p-2 text-mw-sub hover:bg-mw-bg">✕</button>
            </div>
            <div className="mt-4 rounded-xl border border-mw-line bg-mw-bg p-4 text-sm leading-6 text-mw-body">{template.body}</div>
            {!ready ? (
              <p role="status" className="mt-3 rounded-lg bg-mw-tint-blue px-3 py-2 text-xs leading-5 text-mw-body">
                실제 발송 전 솔라피 API와 승인 템플릿을 자동화 설정에서 연결해야 합니다. 연결 전에는 고객에게 전송되지 않습니다.
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-lg border border-mw-line px-4 text-sm text-mw-sub">취소</button>
              <Link href="/settings/automations#solapi" className="grid h-10 place-items-center rounded-lg border border-mw-primary px-4 text-sm font-semibold text-mw-primary">설정 열기</Link>
              <button type="button" disabled={!ready || recipient === "연락처 확인 필요"} className="h-10 rounded-lg bg-mw-primary px-4 text-sm font-semibold text-mw-on-accent disabled:cursor-not-allowed disabled:opacity-45">확인 후 보내기</button>
            </div>
          </section>
        </BoardModalLayer>
      ) : null}
    </div>
  );
}
