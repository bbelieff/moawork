// 이벤트 화이트리스트 + 커스텀 이벤트 페이로드 타입.
//
// 규약: **여기 없는 이벤트는 전송되지 않는다.** `before_send` 에서 걸러낸다(scrub.ts).
// 화이트리스트를 쓰는 이유 —
//  - 새 화면이 무심코 이벤트를 추가해 미검토 데이터가 수집되는 경로를 막는다.
//  - SDK 가 자동으로 만드는 이벤트도 우리가 켠 기능에서 나오는 것만 남긴다.
// 이벤트를 늘리려면 이 파일에 추가하고 페이로드에 PII 가 없는지 검토한다.

/**
 * 제품 커스텀 이벤트 3종.
 * 값(id)만 싣고 사람이 읽는 문자열(상호·이름·연락처·메모)은 싣지 않는다.
 */
export const CUSTOM_EVENTS = ["deal_created", "deal_moved", "meeting_logged"] as const;

/**
 * SDK 가 자동 생성하는 이벤트 중 **우리가 켠 설정에서 실제로 나오는 것**만.
 * (`disable_surveys: true` 라 survey 계열은 목록에 없다 — 나오면 버려진다.)
 */
export const SDK_EVENTS = [
  "$pageview", // PostHogProvider 가 직접 전송(capture_pageview:false)
  "$pageleave", // capture_pageleave: true
  "$autocapture", // autocapture: true (텍스트·속성은 전면 마스킹)
  "$rageclick", // autocapture 파생
  "$identify", // person_profiles: "identified_only"
  "$set", // identify 시 속성 갱신
  "$snapshot", // session_recording
] as const;

/** 전송이 허용되는 이벤트 전체 — 커스텀 3 + SDK 7 = **10종**. */
export const ALLOWED_EVENTS: readonly string[] = [...CUSTOM_EVENTS, ...SDK_EVENTS];

const ALLOWED_EVENT_SET: ReadonlySet<string> = new Set(ALLOWED_EVENTS);

export function isAllowedEvent(event: string): boolean {
  return ALLOWED_EVENT_SET.has(event);
}

export type CustomEventName = (typeof CUSTOM_EVENTS)[number];

/**
 * 커스텀 이벤트별 페이로드 — **id·enum·수량만**.
 *
 * 타입을 좁게 잡는 것이 1차 방어선이다. 호출부가 고객 상호나 담당자 이름을 넣으려 하면
 * 타입 단계에서 막힌다(스크러빙은 그 뒤의 2차 방어선).
 */
export type AnalyticsEventPayloads = {
  deal_created: {
    deal_id: string;
    /** 파이프라인·단계는 식별자만. 단계 '이름'은 사용자가 바꿀 수 있어 싣지 않는다. */
    pipeline_id?: string;
    stage_id?: string;
    /** 유입 화면(예: "board" | "newcust") — 자유 문자열이 아니라 화면 키. */
    source?: string;
  };
  deal_moved: {
    deal_id: string;
    from_stage_id: string;
    to_stage_id: string;
  };
  meeting_logged: {
    /** 활동(activity) 레코드 id. */
    activity_id: string;
    deal_id?: string;
    /** 미팅 종류 키(예: "call" | "visit"). 메모·요약은 절대 싣지 않는다. */
    kind?: string;
  };
};

/**
 * 페이로드에 실릴 수 있는 값의 형태 — 문자열 id·숫자·불리언뿐.
 * (중첩 객체를 허용하면 도메인 엔티티를 통째로 넣는 실수가 쉬워진다.)
 */
export type EventPropertyValue = string | number | boolean | null | undefined;
