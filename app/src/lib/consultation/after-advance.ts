/**
 * 신규리드 → 상담 넘기기 직후 «대면 상담» 으로 바로 시작한다(belie 2026-10-19:
 * «신규리드에서 비대면·대면 어디로든 갈 수 있게»).
 *
 * 넘기기(advance_new_lead_to_contact)는 같은 행을 리드컨택으로 옮기고 비대면으로 시작한다.
 * 대면을 고른 경우 그 뒤에 같은 행의 상담 기록을 «대면 · 미팅대기 + 미팅 일시» 로 바꾼다.
 * 두 번째 저장이 실패해도 넘기기는 이미 끝났으므로 되돌리지 않고, 화면이 비대면 상담으로 안내한다.
 */
import { readConsultationSnapshotOrFail, setConsultationWorkflow } from "./service";
import type { ConsultationRpcClient } from "./supabaseConsultation";

export type ConsultTarget = "remote" | "inperson";

export function parseConsultTarget(value: unknown): ConsultTarget {
  return value === "inperson" ? "inperson" : "remote";
}

export function consultTargetHref(target: ConsultTarget): string {
  return target === "inperson" ? "/consult-inperson" : "/consult-remote";
}

/** 성공하면 null, 아니면 사용자에게 보일 이유. */
export async function startInpersonAfterAdvance(
  client: ConsultationRpcClient,
  input: Readonly<{ orgId: string; itemId: string; meetingAt: string | null; requestId: string }>,
): Promise<string | null> {
  const meeting = input.meetingAt ? new Date(input.meetingAt) : null;
  if (!meeting || Number.isNaN(meeting.getTime())) return "미팅 일시가 없어 비대면 상담으로 넘겼어요. 상담 칸에서 대면으로 옮겨 주세요.";
  try {
    const snapshot = await readConsultationSnapshotOrFail(client, { orgId: input.orgId, itemId: input.itemId });
    if (!snapshot.assigneeId) return "담당자가 없어 비대면 상담으로 넘겼어요. 담당자를 정한 뒤 대면으로 옮겨 주세요.";
    await setConsultationWorkflow(client, {
      orgId: input.orgId,
      itemId: input.itemId,
      requestId: input.requestId,
      expectedVersion: snapshot.version,
      mode: "inperson",
      phase: "meeting_scheduled",
      meetingAt: meeting.toISOString(),
      assigneeId: snapshot.assigneeId,
      cancel: false,
    });
    return null;
  } catch {
    return "대면 상담 시작을 저장하지 못해 비대면 상담으로 넘겼어요. 상담 칸에서 대면으로 옮겨 주세요.";
  }
}
