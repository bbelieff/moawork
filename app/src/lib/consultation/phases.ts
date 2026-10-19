import type { ChecklistState } from "./checklist";

// ★ #830(167): 비대면 absent(부재) 추가.
// ★ 177(belie 2026-10-19) — 상담 단계 재정의.
//   비대면: 정보수집 → 상담예정 → 상담중 · 부재 · 재상담 · 계약고민 → 계약 진행 / 끝: 보류 · 거절
//   대면:   미팅대기 → 결과 계약 · 완료(다시 미팅대기로) · 변경(일시 바뀜) / 끝: 취소(노쇼·전화 취소)
export const CONSULTATION_PHASE_LABEL = {
  information: "정보수집", scheduled: "상담예정", consulting: "상담중", absent: "부재", on_hold: "보류",
  rejected: "거절", follow_up: "재상담", deliberating: "계약고민", meeting_scheduled: "미팅대기",
  meeting_done: "완료", rescheduled: "변경", cancelled: "취소", contract: "계약 진행",
} as const;
export type ConsultationPhase = keyof typeof CONSULTATION_PHASE_LABEL;
export const REMOTE_PHASES: readonly ConsultationPhase[] = ["information", "scheduled", "consulting", "absent", "follow_up", "deliberating", "on_hold", "rejected", "contract"];
export const INPERSON_PHASES: readonly ConsultationPhase[] = ["meeting_scheduled", "contract", "meeting_done", "rescheduled", "cancelled"];
/** 끝난 상태 — 그 탭 맨 아래 묶음(belie 2026-10-19). */
export const TERMINAL_PHASES: ReadonlySet<ConsultationPhase> = new Set(["on_hold", "rejected", "cancelled"]);
/** 화면에 쓰는 이름 — 대면 «계약» 은 한 단계라 «계약 진행» 대신 «계약». */
export function phaseLabelFor(phase: ConsultationPhase, mode: "remote" | "inperson"): string {
  return mode === "inperson" && phase === "contract" ? "계약" : CONSULTATION_PHASE_LABEL[phase];
}
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
  return phase === "scheduled" || phase === "follow_up" || phase === "meeting_scheduled" || phase === "rescheduled";
}
type HistorySide = { phase: ConsultationPhase; meetingAt: string | null; assigneeId: string | null; absentFromPhase?: ConsultationPhase | null };
export type ConsultationHistory = Readonly<{
  id: string; at: string; actorId: string; kind: string;
  details: { before: HistorySide; after: HistorySide };
}>;
