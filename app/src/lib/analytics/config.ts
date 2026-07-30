// PostHog 설정 — 환경변수 해석과 SDK 초기화 옵션 생성.
//
// 런타임 의존성이 없다(SDK 는 `import type` 으로만 참조 → 번들에서 사라진다).
// 그래서 next.config.ts 도 이 파일을 안전하게 읽을 수 있고, 테스트도 SDK 없이 돈다.
// 실제 초기화는 components/analytics/PostHogProvider 가 한다.
//
// ⚠ 비밀값 규칙: 프로젝트 키는 `NEXT_PUBLIC_POSTHOG_KEY` 로만 주입한다.
//   저장소에는 `.env.example` 의 **형태**만 남기고 값은 `.env.local` 에 둔다.
//   이 파일의 어떤 코드도 키 값을 로그·에러 메시지·이벤트에 넣지 않는다.

import type { CaptureResult, PostHog, PostHogConfig } from "posthog-js";
import { isAllowedEvent } from "./events";
import { scrubEvent, scrubText, type ScrubbableEvent } from "./scrub";

/**
 * 리버스 프록시 경로. **상수다**(환경변수로 바꾸지 않는다).
 * next.config 의 rewrites 와 proxy.ts 의 공개 경로 목록이 같은 값을 봐야 하므로
 * 런타임 설정으로 열어두면 어긋날 수 있다. 바꾸려면 이 상수 하나만 고친다.
 *
 * ⚠ 이름을 고를 때: 프록시를 두는 목적 자체가 광고 차단기·기업 방화벽을 피하는 것이다.
 *   `/analytics` `/tracking` `/telemetry` `/posthog` 처럼 용도가 드러나는 이름은 차단 목록에
 *   패턴으로 올라가 있어 프록시를 둔 의미가 사라진다. `/ingest` 도 PostHog 공식 문서가
 *   예시로 쓰는 대표 경로라 같은 이유로 피한다(배정 지시: 뻔한 이름 금지).
 *   `/mw-sig` = MoaWork signal — 제품 고유어라 일반 필터 패턴에 걸리지 않는다.
 */
export const ANALYTICS_PROXY_PATH = "/mw-sig";

/** Wave B 고정 PostHog US 리전. 환경변수로 덮어쓸 수 없다. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/** 프로젝트 API 키(공개 키)의 형태. 값이 아니라 형태만 검사한다. */
const PROJECT_KEY_SHAPE = /^phc_[A-Za-z0-9]{20,}$/;

export type AnalyticsEnvInput = { key?: string };

export type AnalyticsConfig = {
  /** 프로젝트 공개 키. 로그로 출력하지 않는다. */
  projectKey: string;
  /** 이벤트 전송 경로 — 항상 자기 도메인(프록시). */
  apiHost: string;
  /** PostHog 원본 호스트. "PostHog 에서 보기" 링크와 rewrites 대상. */
  uiHost: string;
};

/**
 * 환경변수 → 설정. **fail-closed**: 키가 없거나 형태가 어긋나면 `null`(분석 비활성)이다.
 * 잘못된 키로 초기화해서 이벤트가 조용히 유실되는 상태를 만들지 않는다.
 */
export function resolveAnalyticsConfig(
  input: AnalyticsEnvInput,
): AnalyticsConfig | null {
  const projectKey = input.key?.trim();
  if (!projectKey || !PROJECT_KEY_SHAPE.test(projectKey)) return null;

  return {
    projectKey,
    apiHost: ANALYTICS_PROXY_PATH,
    // Wave B is US-only. A public environment variable must not be able to
    // redirect analytics or replay traffic to another region/origin.
    uiHost: DEFAULT_POSTHOG_HOST,
  };
}

/**
 * 세션 리플레이 마스킹 정책.
 *
 * 기본값이 "전부 가림" 인 이유: moawork 화면에는 고객 상호·담당자·연락처·정산 금액이
 * 상시 렌더링된다. 민감 요소만 selector 로 골라 가리는 방식은 새 화면이 추가될 때마다
 * 누락되고, 누락은 곧 실제 고객 정보 유출이다. 그래서 텍스트와 입력을 **전부** 가린다.
 *
 * posthog-js 1.407 의 `SessionRecordingOptions` 에는 unmask 계열 옵션이 없다.
 * 즉 선택적 노출은 지원되지 않으며, 이 정책은 그 사실 위에서 세운 fail-closed 기본값이다.
 * 특정 영역을 아예 녹화에서 빼려면 DOM 에 `[data-mw-no-record]` 를 단다.
 */
export const REPLAY_BLOCK_SELECTOR = "[data-mw-no-record],[data-pii]";

/**
 * 화면 전체를 녹화에서 제외할 경로.
 *
 * 이 화면들은 마스킹으로 가리는 수준이 아니라 **아예 녹화하지 않는다** —
 * 사업자등록번호·세금계산서·정산 금액·개인 계정 정보가 화면 구조 자체에 드러나서,
 * 텍스트를 가려도 레이아웃과 상호작용만으로 유추될 여지를 남기지 않기 위해서다.
 *
 * 접두사 매칭이며 경계(`/` 또는 문자열 끝)를 확인한다 — `/accounts-x` 같은
 * 다른 경로가 휩쓸리지 않도록.
 *
 * ⚠ 경로 실측(2026-07-23): 회계 전용 화면은 **아직 없다**. `/account` 는 회계가 아니라
 * "내 정보"(사용자 계정)이며 `/settings/account` 로 리다이렉트된다 — 개인정보가 있어
 * 같은 이유로 제외한다. `/hometax`·`/settlements` 는 아직 UI 가 없지만(T08 대기 ·
 * settlements 는 API 만 존재) 화면이 생기는 즉시 자동 적용되도록 미리 넣어 둔다.
 */
export const REPLAY_EXCLUDED_PATH_PREFIXES: readonly string[] = [
  "/account", // 내 정보(→ /settings/account 로 리다이렉트)
  "/settings/account", // 내 정보 본체 — 세션 목록·개인정보 설정
  "/hometax", // 홈택스(전자세금계산서) — T08 도입 시 자동 적용
  "/settlements", // 정산 금액 — 화면 신설 시 자동 적용
  // ── 아래는 실측으로 추가(2026-07-29). 화면이 **이미 존재**하고 금액·고객정보가 상시 렌더된다.
  "/policyfund", // 정책자금 보드 — 실행액·수수료·계약금 31컬럼(T09 산출물)
  "/contract", // 계약 — 계약 내용·금액
  "/newcust", // 신규고객 — 고객사명·대표자명·연락처
];

/** 이 경로에서는 세션 리플레이를 시작하지 않는다. */
export function isReplayExcludedPath(pathname: string): boolean {
  const path = pathname.split("?")[0].split("#")[0];
  return REPLAY_EXCLUDED_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** 설정 또는 경로가 확정되지 않으면 리플레이 SDK를 아예 건드리지 않는다. */
export function shouldRunReplayPathGate(
  config: AnalyticsConfig | null,
  pathname: string | null,
): boolean {
  return config !== null && Boolean(pathname);
}

/** SDK 준비 후에만 경로별 녹화 정책을 적용한다. */
export function applyReplayPathPolicy(
  client: Pick<PostHog, "startSessionRecording" | "stopSessionRecording">,
  config: AnalyticsConfig | null,
  pathname: string | null,
): boolean {
  if (!shouldRunReplayPathGate(config, pathname) || !config || !pathname) return false;
  if (isReplayExcludedPath(pathname)) client.stopSessionRecording();
  else client.startSessionRecording();
  return true;
}

export function buildSessionRecordingConfig(): PostHogConfig["session_recording"] {
  return {
    maskAllInputs: true,
    maskTextSelector: "*",
    blockSelector: REPLAY_BLOCK_SELECTOR,
    // selector 규칙을 우회해 텍스트가 새더라도 값 패턴을 한 번 더 지운다(이중 방어).
    maskTextFn: (text: string) => scrubText(text),
    maskInputFn: (text: string) => "*".repeat(Math.min(text.length, 32)),
    // 폰트·교차출처 iframe 수집은 재생 품질보다 유출면이 크다.
    collectFonts: false,
    recordCrossOriginIframes: false,
  };
}

/**
 * posthog-js `init` 옵션.
 *
 * 주요 결정:
 *  - `api_host`: 항상 프록시 경로. 광고 차단기에 막히지 않고 3rd-party 요청이 사라진다.
 *  - `ui_host`: PostHog 대시보드의 "사이트에서 보기" 링크가 원본 호스트를 알아야 한다.
 *  - `autocapture`: 최소 이벤트 원칙에 따라 끈다.
 *  - `capture_pageview: false`: App Router pathname template만 직접 보낸다.
 *  - `person_profiles: "identified_only"`: 익명 방문자 프로필을 만들지 않는다.
 *  - `respect_dnt`: 브라우저 Do Not Track 을 존중한다.
 *  - `before_send`: 화이트리스트 게이트 + 마지막 스크러빙.
 *    (구버전 `sanitize_properties` 는 deprecated 라 쓰지 않는다.)
 */
export function buildPostHogOptions(
  config: AnalyticsConfig,
): Partial<PostHogConfig> {
  return {
    api_host: config.apiHost,
    ui_host: config.uiHost,
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    // 경로 정책이 SDK 준비 후 명시적으로 시작할 때까지는 절대 녹화하지 않는다.
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    person_profiles: "identified_only",
    persistence: "localStorage+cookie",
    respect_dnt: true,
    disable_surveys: true,
    session_recording: buildSessionRecordingConfig(),
    before_send: (event: CaptureResult | null) => gateAndScrub(event),
  };
}

/**
 * `before_send` 본체 — **화이트리스트 게이트 → 스크러빙** 순서.
 *
 * null 을 돌려주면 PostHog 가 그 이벤트를 버린다(체인 규약). 게이트를 스크러빙보다
 * 먼저 두는 이유: 목록에 없는 이벤트는 내용을 정리할 필요조차 없이 그냥 버린다.
 * 이름을 모르는 이벤트가 조용히 새 나가는 경로를 없애는 것이 목적이다.
 */
export function gateAndScrub<T extends ScrubbableEvent>(event: T | null): T | null {
  if (!event) return null;
  if (!isAllowedEvent(event.event)) return null;
  return scrubEvent(event);
}

/**
 * 사용자 식별에 쓸 수 있는 속성만 남긴다.
 * 이메일·이름은 보내지 않는다 — 필요하면 PostHog 밖에서 내부 id 로 조인한다.
 */
export function buildIdentifyProperties(input: {
  orgId?: string | null;
  role?: string | null;
  scope?: string | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.orgId) out.org_id = input.orgId;
  if (input.role) out.role = input.role;
  if (input.scope) out.scope = input.scope;
  return out;
}
