import type { NotifyChannel, NotifyMessage, SendResult } from "./types.js";

/**
 * 발송 프로바이더 포트 (이메일/SMS/알림톡 공통).
 *
 * 벤더(SOLAPI·팝빌·NHN Cloud 등) 구현체는 이 인터페이스만 만족하면 교체 가능하다.
 * 벤더 선정은 DI-5(belie 계약 결정) 대기 — 그때까지 구현체는 스텁뿐이다.
 * 비교표·권장안: docs/design/T06-notify-design.md §6
 */
export interface NotificationProvider {
  /** 로그/진단용 식별자 (예: "stub", "solapi"). */
  readonly name: string;
  /** 이 프로바이더가 처리 가능한 채널인지. */
  supports(channel: NotifyChannel): boolean;
  /**
   * 단건 발송. 예외를 던지지 않고 SendResult 로 성패를 표현한다
   * (재시도 여부 판단을 호출자가 일관되게 하기 위함).
   */
  send(message: NotifyMessage): Promise<SendResult>;
}

/** 등록된 프로바이더 중 채널을 지원하는 첫 번째를 고른다. */
export function resolveProvider(
  providers: readonly NotificationProvider[],
  channel: NotifyChannel,
): NotificationProvider | undefined {
  return providers.find((p) => p.supports(channel));
}

/**
 * 발송 대상 메시지를 조회하는 포트.
 *
 * 잡 페이로드에는 messageId 만 싣고 본문·수신처는 DB에서 읽는다
 * (큐에 개인정보를 남기지 않기 위함 — 설계 §3.1).
 * Phase 2 에서 Supabase/PostgREST 어댑터로 구현한다.
 */
export interface MessageLoader {
  /** 없거나 이미 처리된 메시지면 null. */
  load(messageId: string): Promise<NotifyMessage | null>;
}

/**
 * 발송 결과를 messages 행에 반영하는 포트
 * (status/sent_at/error/provider_message_id).
 */
export interface MessageStatusSink {
  markSent(messageId: string, providerMessageId: string): Promise<void>;
  markFailed(messageId: string, error: string): Promise<void>;
}
