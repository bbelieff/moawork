/**
 * 확인 게이트 — «확인 없이는 아무 요청도 나가지 않는다» 를 코드로 못박는 자리 (BBE-148).
 *
 * `SendRequest` 는 브랜드 타입이라 평범한 객체 리터럴로는 만들어지지 않는다. 다만
 * **타입만으로는 부족하다** — 억지로 `as` 캐스팅하면 뚫리고, 지문은 요청 자기 필드로
 * 계산되므로 위조자가 스스로 맞출 수 있다(2026-08-12 독립 검수 실측). 그래서 진짜 잠금은
 * **확인표**다(`ticket.ts`) — 서버 난수이고 한 번 쓰면 태워진다.
 *
 * 정상 경로에서 요청을 만드는 것은 이 파일의 `confirmSend()` 뿐이고, 아래를 전부 통과해야 만든다.
 *
 *   ⓪ ★ 확인표가 유효한가              (사람이 그 화면을 지났다는 유일한 증거 · 1회용)
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

import { planFingerprint } from "./plan";
import type { ConfirmationTicketStore } from "./ticket";
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
 * 요청의 **자가일관성**만 본다 — 내용과 지문이 서로 맞는지.
 *
 * ⚠ **이것은 위조 탐지기가 아니다.** 지문의 재료가 전부 요청 자기 필드라,
 * `planFingerprint()` 를 부를 수 있는 쪽은 지문을 스스로 계산해 넣어 이 검사를 통과한다.
 * 그래서 이름도 «검증» 이 아니라 «자가일관» 이다. 잡을 수 있는 것은 하나뿐이다 —
 * 요청이 만들어진 뒤 **내용만 슬쩍 바뀐** 경우(대상 교체·비용 조작).
 *
 * «사람이 확인했다» 를 증명하는 것은 **확인표뿐이다**(`ticket.ts`). 그것은 서버 난수이고
 * 한 번 쓰면 태워지므로 요청 본문만 보고 지어낼 수 없다. `confirmSend()` 가 그것을 센다.
 */
export function isSelfConsistentRequest(request: SendRequest): boolean {
  return (
    planFingerprint({
      orgId: request.orgId,
      boardId: request.boardId,
      columnKey: request.columnKey,
      value: request.value,
      templateCode: request.templateCode,
      itemIds: request.targets.map((t) => t.itemId),
      estimatedCostKrw: request.estimatedCostKrw,
    }) === request.planFingerprint && request.batchKey === request.planFingerprint.slice(0, 16)
  );
}

/**
 * 실제 전송 직전에 부른다. 지금은 **항상 던진다.**
 *
 * 확인 절차를 다 통과한 요청이라도 이 문을 지나야 나간다. 통로를 붙이는 후속 카드가
 * 이 함수 하나만 열면 되고, 그전까지는 누가 실수로 배선해도 여기서 죽는다.
 * 통로가 열린 뒤에도 «내용이 바뀐 요청» 은 여기서 다시 걸린다.
 */
export function assertDispatchAllowed(request?: SendRequest): void {
  if (!SEND_DISPATCH_ENABLED) {
    throw new Error(DISPATCH_DISABLED_REASON);
  }
  if (request && !isSelfConsistentRequest(request)) {
    throw new Error("발송 요청이 확인 화면의 계획과 다릅니다. 다시 확인하세요.");
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
 *
 * ★ `plan` 은 **서버가 지금 다시 계산한 것**이어야 한다. 화면이 보낸 값을 그대로 믿고
 * 여기 넣으면 지문 검사가 의미를 잃는다. 소비하는 화면이 지켜야 할 유일한 규칙이다.
 * ★ `store` 는 확인 화면을 그릴 때 확인표를 발급한 그 저장소여야 한다(`defaultTicketStore()`).
 */
export function confirmSend(
  plan: SendPlan,
  confirmation: SendConfirmation | null,
  store: ConfirmationTicketStore,
  nowMs: number,
): SendGateResult {
  if (!confirmation) {
    return { ok: false, reason: "확인 없음", detail: "확인 화면을 지나지 않은 요청입니다." };
  }
  // ★ 확인표부터 태운다. 이것만이 «사람이 그 화면을 지났다» 를 증명한다.
  //    맞든 틀리든 한 번 손대면 태워지므로, 틀린 요청을 반복해 찔러 볼 수 없다.
  const ticketOk = store.consume({
    id: confirmation.ticketId,
    planFingerprint: confirmation.planFingerprint,
    actorId: confirmation.actorId,
    nowMs,
  });
  if (!ticketOk) {
    return {
      ok: false,
      reason: "확인표 무효",
      detail: "확인 화면을 지나지 않았거나, 이미 쓴 확인표이거나, 시간이 지났습니다. 다시 확인하세요.",
    };
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
