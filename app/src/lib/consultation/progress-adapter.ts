/**
 * 상담 → 기존 진행현황 어댑터.
 *
 * `lib/workflow/progress.ts` 를 고치지 않고 상담 단계를 기존 진행현황에 투영한다.
 * remote/inperson 은 기존 contact 진행현황으로 읽힌다 — 화면이 새 단계를
 * 배우기 전까지의 임시 다리이며, 전용 매핑은 UI 후속 패스에서 이 파일을 넓힌다.
 */

import type { WorkflowProgressKind } from "@/lib/workflow/progress";
import { CONSULTATION_STAGE_LABEL, type ConsultationStage } from "./stages";

export function progressKindForConsultationStage(stage: ConsultationStage): WorkflowProgressKind {
  switch (stage) {
    case "new_lead":
      return "new-lead";
    case "remote":
    case "inperson":
      return "contact";
  }
}

export function consultationStageDisplayName(stage: ConsultationStage): string {
  return CONSULTATION_STAGE_LABEL[stage];
}
