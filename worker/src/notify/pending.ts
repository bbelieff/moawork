import type { MessageLoader, MessageStatusSink } from "./provider.js";

/**
 * 미구현 어댑터 (Phase 2 대기).
 *
 * messages 테이블 연동은 아직 없다. 로더가 항상 null 을 돌려주므로 큐에 잡이 들어와도
 * "대상 메시지 없음"으로 즉시 종결되고 **실제 발송은 일어나지 않는다** — 벤더/엔타이틀먼트가
 * 확정되기 전 오발송을 원천 차단하기 위한 의도적 무해 동작이다.
 *
 * Phase 2 에서 Supabase(PostgREST) 어댑터로 교체한다:
 *   - load       → messages + message_templates 조인, status='queued' 만
 *   - markSent   → status='sent',   sent_at=now(), provider_message_id
 *   - markFailed → status='failed', error
 */
export const pendingLoader: MessageLoader = {
  async load() {
    return null;
  },
};

export const pendingSink: MessageStatusSink = {
  async markSent(messageId, providerMessageId) {
    console.warn(
      `[notify] 상태 저장 미구현 — sent 무시 messageId=${messageId} provider=${providerMessageId}`,
    );
  },
  async markFailed(messageId) {
    console.warn(`[notify] 상태 저장 미구현 — failed 무시 messageId=${messageId}`);
  },
};
