"use client";

/**
 * 상담 진행 셀 — 표에서 계약 4단계의 진행상황·현재 필요 단계를 읽고,
 * 그 자리(짧은 팝오버)에서 바로 수동 확인한다.
 *
 * 확인 자체는 `ConsultationPanel` 을 그대로 재사용한다 — 같은 보호 서버 경로
 * (151 RPC)만 쓴다. EAV·거울 쓰기 없음. 업무이동 메뉴를 찾아 들어갈 필요 없이
 * 이 셀의 «확인 열기»에서 바로 닿는다.
 */

import { useId, useRef, useState } from "react";
import { consultationPhase, CONSULTATION_PHASE_LABEL } from "@/lib/consultation/phases";
import { ConsultationPanel } from "./ConsultationPanel";
import {
  consultationProgressSummary,
  type ConsultationBoardEntry,
} from "@/lib/consultation/boardView";

export function ConsultationProgressCell({
  itemId,
  title,
  entry,
  meetingAt,
  assigneeId,
  members,
  companyName,
}: Readonly<{
  itemId: string;
  title: string;
  /** 단계 보기 적재분. 없으면(적재 실패 등) 읽기 전용 요약 없이 안내만 둔다. */
  entry?: ConsultationBoardEntry | null;
  meetingAt?: string | null;
  assigneeId?: string | null;
  members?: ReadonlyArray<{ id: string; label: string }>;
  companyName?: string;
}>) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptionId = useId();
  const phase = entry ? consultationPhase(entry) : null;
  const summary = entry ? consultationProgressSummary(entry.checklist) : null;

  function openDialog() {
    setOpen(true);
    dialog.current?.showModal();
  }

  return (
    <div className="min-w-44">
      <p className="text-xs font-semibold text-mw-fg" aria-describedby={descriptionId}>
        {entry && phase !== "contract" ? (
          <>{CONSULTATION_PHASE_LABEL[phase!]}{entry.meetingAt ? <span className="ml-1 font-normal text-mw-sub">{new Date(entry.meetingAt).toLocaleString("ko-KR")}</span> : null}</>
        ) : entry ? (
          <>
            계약 {summary!.done}/{summary!.total}
            <span className="ml-1 font-normal text-mw-sub">
              {summary!.nextLabel ? `다음: ${summary!.nextLabel}` : "4단계 완료"}
            </span>
          </>
        ) : (
          <span className="font-normal text-mw-sub">상담 기록 없음</span>
        )}
      </p>
      <span id={descriptionId} className="sr-only">
        계약서 송부 → 서명본 발송 → 상대 서명 확인 → 착수금 입금 확인 순서로 직접 확인합니다.
      </span>
      <button
        type="button"
        onClick={openDialog}
        aria-label={`${title} 상담 확인 열기`}
        data-no-drag
        className="mt-1 min-h-9 border border-mw-line px-2 text-xs font-semibold text-mw-body"
        style={{ borderRadius: "var(--mw-r-1, 3px)" }}
      >
        확인 열기
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${descriptionId}-title`}
        className="fixed inset-0 m-auto max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto whitespace-normal rounded-md border border-mw-line bg-mw-card p-0 text-mw-fg shadow-lg backdrop:bg-slate-950/50 backdrop:backdrop-blur-[1px]"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-mw-line px-5 py-4">
          <div>
            <p className="text-xs font-semibold text-mw-record">
              {entry ? (entry.mode === "remote" ? "비대면 상담" : "대면 상담") : "상담 확인"}
            </p>
            <h2 id={`${descriptionId}-title`} className="mt-1 text-lg font-bold tracking-tight">
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => dialog.current?.close()}
            className="h-8 w-8 rounded-full border border-mw-line text-mw-sub hover:bg-mw-bg"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          {open ? (
            <ConsultationPanel
              itemId={itemId}
              title={title}
              initialMeetingAt={entry?.meetingAt ?? meetingAt ?? null}
              currentAssigneeId={assigneeId ?? null}
              members={members ?? []}
              initialCompanyName={companyName ?? title}
            />
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
