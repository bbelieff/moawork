/**
 * 발송 이력 — «언제 · 누가 · 무엇을» (BBE-148).
 *
 * 이력은 **나간 뒤에만 남기는 것이 아니다.** 확인 화면을 띄운 것도, 사람이 닫은 것도,
 * 게이트가 막은 것도 남긴다. 「누가 뭘 하려다 말았는가」가 돈이 걸린 칸에서는 증거가 된다.
 *
 * 이 모듈은 이력 «항목» 만 만든다. 저장은 호출자가 한다 — 보드 이력이든
 * `message_outbox_audit`(058)이든 붙일 곳은 소비하는 화면이 정한다.
 */

import { exclusionCounts } from "./plan";
import type { SendHistoryEntry, SendPlan, SendRejectionReason, SendRequest } from "./types";

interface Actor {
  actorId: string;
  actorName: string;
}

function base(plan: SendPlan, actor: Actor, occurredAt: string) {
  return {
    occurredAt,
    actorId: actor.actorId,
    actorName: actor.actorName,
    orgId: plan.orgId,
    boardId: plan.boardId,
    columnKey: plan.columnKey,
    columnLabel: plan.columnLabel,
    value: plan.value,
    templateCode: plan.templateCode,
    channel: plan.channel,
    sendableCount: plan.sendable.length,
    excludedCount: plan.excluded.length,
    estimatedCostKrw: plan.estimatedCostKrw,
    planFingerprint: plan.fingerprint,
  };
}

/** 제외 사유 요약 — 「번호 없음 2건 · 수신 거부 1건」. */
export function exclusionSummary(plan: SendPlan): string {
  const counts = exclusionCounts(plan);
  if (counts.length === 0) return "";
  return counts.map((c) => `${c.reason} ${c.count}건`).join(" · ");
}

/** 확인 화면을 띄웠다. 아직 아무것도 안 나갔다. */
export function confirmRequestedEntry(
  plan: SendPlan,
  actor: Actor,
  occurredAt: string,
): SendHistoryEntry {
  const excluded = exclusionSummary(plan);
  return {
    ...base(plan, actor, occurredAt),
    event: "확인 요청",
    itemId: plan.sendable.length === 1 ? plan.sendable[0].itemId : null,
    summary:
      `«${plan.columnLabel}» 을(를) «${plan.value}» 로 바꾸려 합니다 — ` +
      `보낼 ${plan.sendable.length}건 · 예상 ${plan.estimatedCostKrw.toLocaleString("ko-KR")}원` +
      (excluded ? ` · 제외 ${excluded}` : ""),
  };
}

/** 사람이 확인 화면을 닫았다. 나가지 않았다는 사실을 남긴다. */
export function confirmCancelledEntry(
  plan: SendPlan,
  actor: Actor,
  occurredAt: string,
): SendHistoryEntry {
  return {
    ...base(plan, actor, occurredAt),
    event: "확인 취소",
    itemId: plan.sendable.length === 1 ? plan.sendable[0].itemId : null,
    summary: `«${plan.columnLabel}» 발송을 확인 화면에서 취소했습니다 — 나간 건 없습니다.`,
  };
}

/** 게이트가 막았다. 왜 막혔는지가 이력의 본문이다. */
export function blockedEntry(
  plan: SendPlan,
  actor: Actor,
  occurredAt: string,
  reason: SendRejectionReason,
  detail: string,
): SendHistoryEntry {
  return {
    ...base(plan, actor, occurredAt),
    event: "발송 차단",
    itemId: plan.sendable.length === 1 ? plan.sendable[0].itemId : null,
    summary: `발송이 막혔습니다 — ${reason}. ${detail}`,
  };
}

/**
 * 발송 «요청» 이 만들어졌다. 실제 전송은 아직이다(통로 비활성 — BBE-30).
 *
 * 건별 이력을 원하면 `perTarget` 을 true 로 준다 — 각 건의 히스토리에 한 줄씩 남는다.
 * 목업이 약속한 「엑셀로 내보내지 않았습니다 — 각 건의 히스토리에 발송이 남습니다」가 이것이다.
 */
export function requestedEntries(
  plan: SendPlan,
  request: SendRequest,
  perTarget = true,
): SendHistoryEntry[] {
  const actor = { actorId: request.confirmedBy.actorId, actorName: request.confirmedBy.actorName };
  const batch: SendHistoryEntry = {
    ...base(plan, actor, request.confirmedAt),
    event: "발송 요청",
    itemId: null,
    summary:
      `«${plan.columnLabel}» — ${request.targets.length}건 발송을 요청했습니다 · ` +
      `예상 ${request.estimatedCostKrw.toLocaleString("ko-KR")}원 · 배치 ${request.batchKey}`,
  };
  if (!perTarget) return [batch];

  return [
    batch,
    ...request.targets.map((target) => ({
      ...base(plan, actor, request.confirmedAt),
      event: "발송 요청" as const,
      itemId: target.itemId,
      sendableCount: 1,
      excludedCount: 0,
      estimatedCostKrw: plan.unitCostKrw,
      summary:
        `${target.phoneMasked} 앞으로 «${plan.columnLabel}» 안내를 요청했습니다 ` +
        `(${plan.channel === "sms" ? "문자" : "알림톡"} · 문구 ${plan.templateCode}).`,
    })),
  ];
}
