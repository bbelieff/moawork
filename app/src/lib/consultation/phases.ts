import type { ChecklistState } from "./checklist";

// ★ #830(167): 비대면 absent(부재) · 대면 deliberating(미팅 후 고민 중) 추가, cancelled 는 «미팅취소».
export const CONSULTATION_PHASE_LABEL = {
  information: "정보수집", scheduled: "상담예정", consulting: "상담중", absent: "부재", on_hold: "보류",
  rejected: "거절", follow_up: "재상담", meeting_scheduled: "대면상담예약",
  meeting_done: "미팅완료", cancelled: "미팅취소", deliberating: "미팅 후 고민 중", contract: "계약 진행",
} as const;
export type ConsultationPhase = keyof typeof CONSULTATION_PHASE_LABEL;
export const REMOTE_PHASES: readonly ConsultationPhase[] = ["information", "scheduled", "consulting", "absent", "on_hold", "rejected", "follow_up", "contract"];
export const INPERSON_PHASES: readonly ConsultationPhase[] = ["meeting_scheduled", "meeting_done", "cancelled", "deliberating", "contract"];
export function isConsultationPhase(value: unknown): value is ConsultationPhase {
  return typeof value === "string" && Object.hasOwn(CONSULTATION_PHASE_LABEL, value);
}
export function consultationPhase(input: { phase?: ConsultationPhase; mode?: string; stage?: string; meetingAt: string | null; checklist: ChecklistState }): ConsultationPhase {
  if (input.phase) return input.phase;
  if (Object.values(input.checklist).some((step) => step.confirmed)) return "contract";
  if ((input.mode ?? input.stage) === "inperson") return "meeting_scheduled";
  return input.meetingAt ? "scheduled" : "information";
}
/** 화면 단계 이름 — 부재는 어느 단계에서 왔는지 함께 쓴다(«부재 · 상담예정에서»). */
export function phaseLabel(phase: ConsultationPhase, absentFrom?: ConsultationPhase | null): string {
  const base = CONSULTATION_PHASE_LABEL[phase];
  return phase === "absent" && absentFrom && absentFrom !== "absent"
    ? `${base} · ${CONSULTATION_PHASE_LABEL[absentFrom]}에서`
    : base;
}
export function phaseNeedsSchedule(phase: ConsultationPhase): boolean {
  return phase === "scheduled" || phase === "follow_up" || phase === "meeting_scheduled";
}
type HistorySide = { phase: ConsultationPhase; meetingAt: string | null; assigneeId: string | null; absentFromPhase?: ConsultationPhase | null };
export type ConsultationHistory = Readonly<{
  id: string; at: string; actorId: string; kind: string;
  details: { before: HistorySide; after: HistorySide };
}>;
