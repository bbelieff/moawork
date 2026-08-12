/**
 * 발송 안전장치 (BBE-148) — 발송 칸을 쓰는 «모든 탭» 이 공유하는 부품.
 *
 * ## 인터페이스 (고정 — 바뀌면 소비하는 세션에 이름으로 알린다)
 *
 * ```
 * 입력   planSend({ 대상 건 목록 · 컬럼 · 바뀐 값 · 수신거부 · 이미 보낸 키 · 보내는 회사 })
 *          → SendPlan | null      null 이면 발송 칸이 아니거나 발송을 일으키지 않는 값이다
 *
 * 동작   <SendConfirmDialog plan={...} />  로 확인 화면을 띄운다
 *          → 사람이 확인하면 SendConfirmation 이 만들어진다
 *          → confirmSend(plan, confirmation) → { ok:true, request } | { ok:false, reason }
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
 */

export * from "./catalog";
export * from "./confirm";
export * from "./history";
export * from "./plan";
export * from "./template";
export * from "./types";
