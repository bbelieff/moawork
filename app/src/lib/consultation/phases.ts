import type { ChecklistState } from "./checklist";

export const CONSULTATION_PHASE_LABEL = {
  information: "정보수집", scheduled: "상담예정", consulting: "상담중", on_hold: "보류",
  rejected: "거절", follow_up: "재상담", meeting_scheduled: "대면상담예약",
  meeting_done: "미팅완료", cancelled: "취소", contract: "계약 진행",
} as const;
export type ConsultationPhase = keyof typeof CONSULTATION_PHASE_LABEL;
export const REMOTE_PHASES: readonly ConsultationPhase[] = ["information", "scheduled", "consulting", "on_hold", "rejected", "follow_up", "contract"];
export const INPERSON_PHASES: readonly ConsultationPhase[] = ["meeting_scheduled", "meeting_done", "cancelled", "contract"];
export function isConsultationPhase(value: unknown): value is ConsultationPhase {
  return typeof value === "string" && Object.hasOwn(CONSULTATION_PHASE_LABEL, value);
}
export function consultationPhase(input: { phase?: ConsultationPhase; mode?: string; stage?: string; meetingAt: string | null; checklist: ChecklistState }): ConsultationPhase {
  if (input.phase) return input.phase;
  if (Object.values(input.checklist).some((step) => step.confirmed)) return "contract";
  if ((input.mode ?? input.stage) === "inperson") return "meeting_scheduled";
  return input.meetingAt ? "scheduled" : "information";
}
export function phaseNeedsSchedule(phase: ConsultationPhase): boolean {
  return phase === "scheduled" || phase === "follow_up" || phase === "meeting_scheduled";
}
export type ConsultationHistory = Readonly<{
  id: string; at: string; actorId: string; kind: string;
  details: { before: { phase: ConsultationPhase; meetingAt: string | null; assigneeId: string | null };
    after: { phase: ConsultationPhase; meetingAt: string | null; assigneeId: string | null } };
}>;
