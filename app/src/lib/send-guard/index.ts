/**
 * 발송 안전장치 (BBE-148) — 발송 칸을 쓰는 «모든 탭» 이 공유하는 부품.
 *
 * ## 인터페이스 (고정 — 바뀌면 소비하는 세션에 이름으로 알린다)
 *
 * ```
 * 입력   planSend({ 대상 건 목록 · 컬럼 · 바뀐 값 · 수신거부 · 이미 보낸 키 · 보내는 회사 })
 *          → SendPlan | null      null 이면 발송 칸이 아니거나 발송을 일으키지 않는 값이다
 *
 * 동작   const ticket = issueConfirmationTicket(defaultTicketStore(), plan, actorId, Date.now())
 *        <SendConfirmDialog plan={plan} ticketId={ticket.id} … />  로 확인 화면을 띄운다
 *          → 사람이 확인하면 SendConfirmation(ticketId 포함)이 돌아온다
 *          → ★ 서버가 planSend() 로 계획을 **다시 계산**한 뒤
 *            confirmSend(plan, confirmation, defaultTicketStore(), Date.now())
 *              → { ok:true, request } | { ok:false, reason }
 *
 * 출력   request.targets(성공 후보) · plan.excluded(제외, 사유별) · SendGateResult(실패 사유)
 *          이력  confirmRequestedEntry · confirmCancelledEntry · blockedEntry · requestedEntries
 * ```
 *
 * ## 이 부품이 하지 않는 것
 *
 * - **탭 화면을 만들지 않는다.** 보드 탭은 소비하는 칸의 소유다.
 * - **실제로 보내지 않는다.** 통로는 «보존하되 활성화 금지»(BBE-30) —
 *   `assertDispatchAllowed()` 가 지금은 항상 던진다.
 *
 * ## ⚠ 이 배럴은 서버 전용이다
 *
 * `plan.ts` 가 지문을 만들려고 `node:crypto` 를 부른다. 그래서 **`"use client"` 파일에서
 * 이 배럴을 import 하면 빌드가 깨진다.** 화면 쪽에서는 필요한 모듈만 직접 가져와라 —
 * `send-guard/types`(타입) · `send-guard/exclusions` · `send-guard/template` 은 순수하다.
 * `SendConfirmDialog` 가 그렇게 하고 있다.
 */

export * from "./catalog";
export * from "./confirm";
export * from "./exclusions";
export * from "./history";
export * from "./plan";
export * from "./template";
export * from "./ticket";
export * from "./types";
