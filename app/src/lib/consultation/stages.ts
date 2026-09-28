/**
 * 상담 모드 — 하나의 리드컨택 행을 두 뷰(remote|inperson)로 본다.
 *
 * - 신규리드(new_lead)는 보드 위치다. 상담 쓰기가 아니라 기존
 *   `advance_new_lead_to_contact`(lead_to_contact) 전이로만 옮긴다(ID 보존).
 * - contact 보드 행은 mode=remote(기본, backfill 없음) 또는 inperson 이다.
 *   두 뷰는 같은 item/deal 을 공유하며 어느 쪽도 인계에 4체크를 요구한다.
 * - 실제 인계는 기존 contact_to_work 파이프라인이 수행하고, 151 래퍼가
 *   활성 상담행의 4완료를 같은 트랜잭션 안에서 강제한다.
 */

import { ConsultationError } from "./errors";

export const CONSULTATION_STAGES = ["new_lead", "remote", "inperson"] as const;
export type ConsultationStage = (typeof CONSULTATION_STAGES)[number];

export const CONSULTATION_STAGE_LABEL: Record<ConsultationStage, string> = {
  new_lead: "신규리드",
  remote: "비대면 상담",
  inperson: "대면 상담",
};

/** 모드 전환 후보 — 신규리드는 상담 전이가 아니라 정식 이전의 자리다. */
const NEXT: Record<ConsultationStage, readonly ConsultationStage[]> = {
  new_lead: [],
  remote: ["inperson"],
  inperson: ["remote"],
};

/** 계약 인계로 직접 갈 수 있는 단계 — remote 와 inperson 모두 가능, new_lead 는 불가. */
const HANDOFF_ELIGIBLE: ReadonlySet<ConsultationStage> = new Set(["remote", "inperson"]);

export function nextConsultationStages(stage: ConsultationStage): readonly ConsultationStage[] {
  return NEXT[stage];
}

export function canRequestHandoff(stage: ConsultationStage): boolean {
  return HANDOFF_ELIGIBLE.has(stage);
}

export function assertStageTransition(from: ConsultationStage, to: ConsultationStage): void {
  if (!NEXT[from].includes(to)) {
    throw new ConsultationError(
      "stage_contract",
      from === "new_lead"
        ? "신규리드는 리드컨택으로 먼저 옮겨 주세요. 상담 단계 이동이 아닙니다."
        : "이 단계에서는 다른 상담 보기로 넘길 수 없습니다.",
      { field: "stage", echo: { from, to } },
    );
  }
}

export interface ScheduleInput {
  meetingAt: string | null;
  assigneeId: string | null;
}

/** 일정 누락 검증 — 실패해도 제출값은 echo 로 돌려준다. DB RPC가 최종 검증이다. */
export function assertSchedulable(input: ScheduleInput): void {
  const echo = { meetingAt: input.meetingAt, assigneeId: input.assigneeId };
  if (!input.meetingAt || !input.meetingAt.trim()) {
    throw new ConsultationError("validation", "상담 일시를 입력해 주세요. 입력한 내용은 그대로 둡니다.", {
      field: "meetingAt",
      echo,
    });
  }
  if (Number.isNaN(Date.parse(input.meetingAt))) {
    throw new ConsultationError("validation", "상담 일시의 형식을 확인해 주세요. 입력한 내용은 그대로 둡니다.", {
      field: "meetingAt",
      echo,
    });
  }
  if (!input.assigneeId || !input.assigneeId.trim()) {
    throw new ConsultationError("validation", "담당자를 지정해 주세요. 입력한 내용은 그대로 둡니다.", {
      field: "assigneeId",
      echo,
    });
  }
}
