"use client";

/** 상담 진행 요약과 동일 업체 상세의 상담 영역을 여는 진입점. */

import { useId } from "react";
import { requestItemDetailOpen } from "@/lib/boards/item-detail-open";
import { consultationPhase, phaseLabel } from "@/lib/consultation/phases";
import {
  CONTRACT_STEP_GROUPS,
  contractStepGroupKey,
  type ConsultationBoardEntry,
} from "@/lib/consultation/boardView";

export function ConsultationProgressCell({
  itemId,
  title,
  entry,
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
  const descriptionId = useId();
  const phase = entry ? consultationPhase(entry) : null;
  // ★ 167: 계약 진행은 «1단계 · 계약금 입금 확인 → 2단계 · 직인 → 계약 확인 완료» 중 현재 자리를 보여준다.
  const contractStep = entry && phase === "contract"
    ? CONTRACT_STEP_GROUPS.find((group) => group.key === contractStepGroupKey(entry))!
    : null;

  return (
    <div className="flex min-w-44 items-center gap-1.5">
      <p className="min-w-0 flex-1 truncate text-xs font-semibold text-mw-fg" aria-describedby={descriptionId}>
        {entry && phase !== "contract" ? (
          <>{phaseLabel(phase!, entry.absentFromPhase)}{entry.meetingAt ? <span className="ml-1 font-normal text-mw-sub">{new Date(entry.meetingAt).toLocaleString("ko-KR")}</span> : null}</>
        ) : entry ? (
          <>{contractStep!.title}</>
        ) : (
          <span className="font-normal text-mw-sub">상담 기록 없음</span>
        )}
      </p>
      <span id={descriptionId} className="sr-only">
        계약금 입금 확인 → 직인
      </span>
      <button
        type="button"
        onClick={(event) => requestItemDetailOpen(itemId, event.currentTarget)}
        aria-label={`${title} 상담 확인 열기`}
        data-no-drag
        // 2026-10-19 — 한 줄 행: 단계 글자 옆 작은 알약.
        className="inline-flex h-6 shrink-0 items-center rounded-full border border-mw-line bg-mw-card px-2 text-[0.68rem] font-semibold text-mw-body hover:border-mw-record hover:text-mw-record"
      >
        확인 열기
      </button>
    </div>
  );
}
