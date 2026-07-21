/**
 * mod.notify 발송 도메인 타입 (Phase 2 스캐폴드).
 *
 * 설계 근거: docs/design/T06-notify-design.md
 * 스키마 근거: supabase/migrations/001_schema_v1.sql
 *   - message_channel enum = ('alimtalk','sms')
 *   - message_status  enum = ('queued','sent','failed','canceled')
 *
 * ⚠ 채널 범위 주의: 정본 스키마에는 email 채널이 없다(alimtalk/sms 만).
 * 배정 지시("이메일/SMS 발송 인터페이스")를 충족하기 위해 인터페이스는 채널 무관하게
 * 두되, email 은 **스키마 미반영 확장 채널**로 표시한다. 실제 email 발송을 도입하려면
 * message_channel enum 확장 마이그레이션이 선행돼야 한다(기획/스키마 오너 판단).
 */

/** 스키마 message_channel 과 1:1 대응하는 채널. */
export type SchemaNotifyChannel = "alimtalk" | "sms";

/** 스키마에 아직 없는 확장 채널(인터페이스 선반영용). */
export type ExtendedNotifyChannel = "email";

export type NotifyChannel = SchemaNotifyChannel | ExtendedNotifyChannel;

/** 정본 스키마(message_channel)가 현재 수용하는 채널인지. */
export function isSchemaChannel(channel: NotifyChannel): channel is SchemaNotifyChannel {
  return channel === "alimtalk" || channel === "sms";
}

/**
 * 프로바이더에 전달되는 발송 단위.
 * 벤더 중립 — 특정 벤더(SOLAPI/팝빌 등) 필드를 넣지 않는다.
 */
export interface NotifyMessage {
  /** messages.id (추적/멱등 키) */
  id: string;
  channel: NotifyChannel;
  /** messages.to_addr — email 이면 주소, sms/alimtalk 이면 수신번호 */
  to: string;
  /** email 제목. sms/alimtalk 에서는 무시된다. */
  subject?: string;
  /** 치환이 끝난 본문. */
  body: string;
  /** 알림톡 승인 템플릿 코드(message_templates.code). 알림톡 발송의 전제. */
  templateCode?: string;
  /** 템플릿 변수 치환값(감사/재발송용 스냅샷). */
  variables?: Record<string, string>;
}

/**
 * 발송 결과.
 * retryable 구분이 재시도 정책의 근거다 — 일시 오류만 재시도하고,
 * 영구 오류(잘못된 번호·미승인 템플릿)는 즉시 실패 처리한다.
 */
export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

/** 성공 결과 헬퍼. */
export function sendOk(providerMessageId: string): SendResult {
  return { ok: true, providerMessageId };
}

/** 실패 결과 헬퍼. */
export function sendFailed(error: string, retryable: boolean): SendResult {
  return { ok: false, error, retryable };
}
