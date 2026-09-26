import { CONSULTATION_PHASE_LABEL, isConsultationPhase } from "./phases";

export type ConsultationFeedEvent = {
  id: string; kind: string; step: string; before: boolean | null; after: boolean | null;
  actor_id: string; at: string; details: unknown;
};
const STEPS: Record<string,string> = {
  contract_sent: "계약서 송부", signed_copy_sent: "서명본 발송",
  counterparty_signature_confirmed: "상대 서명 확인", deposit_confirmed: "착수금 입금 확인",
};
const object = (value: unknown): Record<string,unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
const stateLabel = (value: boolean | null) => value === true ? "확인" : value === false ? "미확인" : "기록 없음";
const dateLabel = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("ko-KR", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}) : "일정 없음";

/** Read-only presentation of the existing RLS-authorized audit; never a new editable memo. */
export function consultationFeedEvent(event: ConsultationFeedEvent, members: readonly {id:string;name:string|null}[]) {
  const details=object(event.details), before=object(details.before), after=object(details.after);
  const changes: string[]=[];
  const person=(value:unknown)=>value==null ? "미배정" : members.find((member)=>member.id===value)?.name?.trim() || "이름 확인 불가";
  if(event.kind==="seal_approved") {
    const seal=(value:unknown)=>value==="완료" ? "완료" : "대기";
    changes.push(`직인 승인: ${seal(before.deal)} → ${seal(after.deal)}`);
  } else if(STEPS[event.step]) {
    changes.push(`${STEPS[event.step]}: ${stateLabel(event.before)} → ${stateLabel(event.after)}${event.kind==="invalidated" ? " (앞 단계 취소)" : ""}`);
  } else {
    if(before.mode!==after.mode && (before.mode||after.mode)) {
      const mode=(value:unknown)=>value==="remote" ? "비대면" : value==="inperson" ? "대면" : "기록 없음";
      changes.push(`상담 방식: ${mode(before.mode)} → ${mode(after.mode)}`);
    }
    if(before.phase!==after.phase && (before.phase||after.phase)) {
      const phase=(value:unknown)=>isConsultationPhase(value) ? CONSULTATION_PHASE_LABEL[value] : "기록 없음";
      changes.push(`상담 단계: ${phase(before.phase)} → ${phase(after.phase)}`);
    }
    if(before.assigneeId!==after.assigneeId) changes.push(`담당자: ${person(before.assigneeId)} → ${person(after.assigneeId)}`);
    if(before.meetingAt!==after.meetingAt) changes.push(`상담 예약: ${dateLabel(before.meetingAt)} → ${dateLabel(after.meetingAt)}`);
    if(!changes.length) changes.push(event.kind==="appointment_cancelled" ? "상담 예약 취소" : "상담 변경 · 상세 내용 확인 불가");
  }
  return {id:`consultation:${event.id}`,kind:"consultation" as const,body:changes.join(" · "),actor_id:event.actor_id,created_at:event.at};
}
