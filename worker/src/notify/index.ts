/**
 * mod.notify — 알림 발송 (Phase 2 스캐폴드).
 *
 * 현재는 **스텁**이다: 큐/핸들러/포트 배선만 있고 실제 벤더 발송·DB 연동은 없다.
 * 활성화 전제 — ① 벤더 계약(DI-5) ② mod.notify entitlement ON(현재 MVP 미포함)
 * ③ MessageLoader/MessageStatusSink 의 Supabase 어댑터 구현.
 * 설계 전문: docs/design/T06-notify-design.md
 */
export * from "./types.js";
export * from "./provider.js";
export * from "./job.js";
export * from "./register.js";
export { StubProvider, defaultProviders } from "./providers/stub.js";
