"use client";

// 커스텀 이벤트 전송 훅.
//
// 사용:
//   const track = useTrack();
//   track("workspace_request_result", { kind: "join", outcome: "success" });
//
// 설계:
//  - 이벤트 이름과 페이로드가 **타입으로 고정**된다. 화이트리스트에 없는 이름이나
//    정의되지 않은 필드는 컴파일 단계에서 막힌다(런타임 화이트리스트는 2차 방어선).
//  - 분석이 꺼져 있거나 SDK 로드 전이면 조용히 무시한다 — 분석 때문에 제품이 멈추지 않는다.
//  - 반환 함수는 참조가 안정적이라(useCallback, 의존성 없음) effect 의존성 배열에
//    넣어도 재실행을 유발하지 않는다.

import { useCallback } from "react";
import { capture } from "./client";
import type { AnalyticsEventPayloads, CustomEventName, EventPropertyValue } from "./events";
import { isAllowedEvent } from "./events";

/** 페이로드에서 undefined 필드를 걷어낸다(빈 키가 이벤트에 남지 않도록). */
function compact(payload: Record<string, EventPropertyValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export type TrackFn = <E extends CustomEventName>(
  event: E,
  payload: AnalyticsEventPayloads[E],
) => void;

/**
 * 커스텀 이벤트 전송 함수를 돌려준다.
 *
 * ⚠ 페이로드에는 **id·enum·수량만** 넣는다. 고객 상호·담당자 이름·연락처·메모는
 * 넣지 않는다(타입이 이미 막지만, 새 필드를 추가할 때 이 규칙을 지켜야 한다).
 */
export function useTrack(): TrackFn {
  return useCallback((event, payload) => {
    // 타입을 우회해 들어온 이름(any 캐스팅 등)도 여기서 차단한다.
    if (!isAllowedEvent(event)) return;
    capture(event, compact(payload as Record<string, EventPropertyValue>));
  }, []);
}

/**
 * 훅을 쓸 수 없는 곳(서버 액션 호출 직후 콜백, 이벤트 핸들러 밖 등)을 위한 함수형 진입점.
 * 동작·제약은 `useTrack` 과 동일하다.
 */
export const track: TrackFn = (event, payload) => {
  if (!isAllowedEvent(event)) return;
  capture(event, compact(payload as Record<string, EventPropertyValue>));
};
