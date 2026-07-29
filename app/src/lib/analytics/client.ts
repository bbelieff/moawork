"use client";

// 분석 클라이언트 얇은 래퍼.
//
// 다른 트랙이 `posthog-js` 를 직접 import 하지 않도록 이 파일만 쓰게 한다.
//  - 분석이 꺼져 있거나(키 미설정·DNT·서버) 아직 로드 전이면 **조용히 아무 일도 안 한다**.
//    분석 때문에 제품 코드가 터지는 일은 없어야 한다.
//  - SDK 는 동적 import 라 초기 번들에 들어가지 않는다.

import type { PostHog } from "posthog-js";

let instance: PostHog | null = null;
const pending: Array<{ event: string; properties?: Record<string, unknown> }> = [];
const MAX_PENDING_EVENTS = 20;

/** PostHogProvider 가 초기화 직후 한 번 호출한다. */
export function setAnalyticsInstance(client: PostHog | null): void {
  instance = client;
  if (!client) {
    pending.splice(0, pending.length);
    return;
  }
  for (const item of pending.splice(0, pending.length)) {
    client.capture(item.event, item.properties);
  }
}

export function getAnalyticsInstance(): PostHog | null {
  return instance;
}

/**
 * 이벤트 전송. 프로퍼티는 SDK 의 `before_send` 스크러빙을 그대로 통과한다.
 * 호출부에서 PII 를 넣지 않는 것이 1차 책임이고, 스크러빙은 2차 방어선이다.
 */
export function capture(event: string, properties?: Record<string, unknown>): void {
  if (instance) {
    instance.capture(event, properties);
    return;
  }
  if (pending.length < MAX_PENDING_EVENTS) pending.push({ event, properties });
}

/** 로그인 사용자 연결. 이메일·이름은 넘기지 않는다(buildIdentifyProperties 참고). */
export function identify(
  distinctId: string,
  properties?: Record<string, string>,
): void {
  instance?.identify(distinctId, properties);
}

/** 로그아웃 시 호출 — 다음 사용자와 세션이 섞이지 않게 한다. */
export function resetAnalytics(): void {
  instance?.reset();
}
