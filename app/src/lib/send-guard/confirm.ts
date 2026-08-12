/**
 * 확인 게이트 — «확인 없이는 아무 요청도 나가지 않는다» 를 코드로 못박는 자리 (BBE-148).
 *
 * `SendRequest` 는 브랜드 타입이라 **객체 리터럴로는 만들 수 없다.** 이 파일의
 * `confirmSend()` 만이 그 타입을 만들 수 있고, 그 함수는 아래를 전부 통과해야만 만든다.
 *
 *   ① 확인이 실제로 있었는가            (없으면 요청 없음)
 *   ② 확인한 계획과 지금 계획이 같은가    (사이에 대상·값·비용이 바뀌면 거부)
 *   ③ 사람이 되돌려준 건수가 맞는가       (화면이 보여 준 수와 다르면 거부)
 *   ④ 대량이면 손으로 친 건수가 맞는가    (`requiresTypedCount`)
 *   ⑤ 보낼 건이 하나라도 있는가
 *
 * ★ 발송 통로는 «보존하되 활성화 금지» 다 — BBE-30 판정.
 * 그래서 이 카드는 «요청 객체» 까지만 만든다. 실제 전송을 붙이려는 코드는
 * `assertDispatchAllowed()` 에서 **반드시 예외로 죽는다.** 조용히 나가는 길을 남기지 않는다.
 */

import type {
  SendConfirmation,
  SendGateResult,
  SendPlan,
  SendRequest,
} from "./types";

/**
 * 발송 통로 활성 여부. **false 다.**
 *
 * provider 설정 · worker 자격증명 · 058 hosted 적용은 belie 개별 승인 사항이다(BBE-30).
 * 이 상수를 true 로 바꾸는 것만으로 문자가 나가서는 안 된다 — 통로를 붙이는 카드가
 * 자격증명·승인·회계까지 함께 처리한다. 여기서는 «지금은 아니다» 를 명시할 뿐이다.
 */
export const SEND_DISPATCH_ENABLED = false as const;

export const DISPATCH_DISABLED_REASON =
  "발송 통로가 아직 활성화되지 않았습니다 (BBE-30 — 보존하되 활성화 금지).";

/**
 * 실제 전송 직전에 부른다. 지금은 **항상 던진다.**
 *
 * 확인 절차를 다 통과한 요청이라도 이 문을 지나야 나간다. 통로를 붙이는 후속 카드가
 * 이 함수 하나만 열면 되고, 그전까지는 누가 실수로 배선해도 여기서 죽는다.
 */
export function assertDispatchAllowed(): void {
  if (!SEND_DISPATCH_ENABLED) {
    throw new Error(DISPATCH_DISABLED_REASON);
  }
}

/** 배치 키 — 같은 확인은 같은 배치다. 재시도해도 두 번 나가지 않는다. */
export function batchKeyFor(plan: SendPlan): string {
  return plan.fingerprint.slice(0, 16);
}

/**
 * 사람의 확인을 받아 발송 요청을 만든다. 하나라도 어긋나면 요청은 만들어지지 않는다.
 *
 * `confirmation` 이 `null` 이면 «확인 화면을 아직 안 지났다» 는 뜻이다 — 그 경로로도
 * 요청이 나가지 않는다는 것을 타입이 아니라 실행으로도 증명하기 위해 명시적으로 받는다.
 */
export function confirmSend(
  plan: SendPlan,
  confirmation: SendConfirmation | null,
): SendGateResult {
  if (!confirmation) {
    return { ok: false, reason: "확인 없음", detail: "확인 화면을 지나지 않은 요청입니다." };
  }
  if (confirmation.planFingerprint !== plan.fingerprint) {
    return {
      ok: false,
      reason: "지문 불일치",
      detail: "확인한 뒤 대상이나 값이 바뀌었습니다. 확인 화면을 다시 띄우세요.",
    };
  }
  if (plan.sendable.length === 0) {
    return { ok: false, reason: "보낼 건 없음", detail: "보낼 수 있는 건이 없습니다." };
  }
  if (confirmation.acknowledgedCount !== plan.sendable.length) {
    return {
      ok: false,
      reason: "건수 불일치",
      detail: `확인 화면은 ${plan.sendable.length}건인데 ${confirmation.acknowledgedCount}건으로 확인됐습니다.`,
    };
  }
  if (plan.requiresTypedCount && confirmation.typedCount !== plan.sendable.length) {
    return {
      ok: false,
      reason: "건수 직접 입력 필요",
      detail: `${plan.sendable.length}건을 직접 입력해야 보낼 수 있습니다.`,
    };
  }

  const request = {
    orgId: plan.orgId,
    boardId: plan.boardId,
    columnKey: plan.columnKey,
    value: plan.value,
    templateCode: plan.templateCode,
    channel: plan.channel,
    targets: plan.sendable,
    estimatedCostKrw: plan.estimatedCostKrw,
    planFingerprint: plan.fingerprint,
    confirmedBy: { actorId: confirmation.actorId, actorName: confirmation.actorName },
    confirmedAt: confirmation.confirmedAt,
    batchKey: batchKeyFor(plan),
  } as SendRequest;

  return { ok: true, request };
}
