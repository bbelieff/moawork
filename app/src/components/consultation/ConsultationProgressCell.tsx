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
    <div className="min-w-44">
      <p className="text-xs font-semibold text-mw-fg" aria-describedby={descriptionId}>
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
        className="mt-1 min-h-9 border border-mw-line px-2 text-xs font-semibold text-mw-body"
        style={{ borderRadius: "var(--mw-r-1, 3px)" }}
      >
        확인 열기
      </button>
    </div>
  );
}
