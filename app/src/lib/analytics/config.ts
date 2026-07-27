// PostHog 설정 — 환경변수 해석과 SDK 초기화 옵션 생성.
//
// 런타임 의존성이 없다(SDK 는 `import type` 으로만 참조 → 번들에서 사라진다).
// 그래서 next.config.ts 도 이 파일을 안전하게 읽을 수 있고, 테스트도 SDK 없이 돈다.
// 실제 초기화는 components/analytics/PostHogProvider 가 한다.
//
// ⚠ 비밀값 규칙: 프로젝트 키는 `NEXT_PUBLIC_POSTHOG_KEY` 로만 주입한다.
//   저장소에는 `.env.example` 의 **형태**만 남기고 값은 `.env.local` 에 둔다.
//   이 파일의 어떤 코드도 키 값을 로그·에러 메시지·이벤트에 넣지 않는다.

import type { CaptureResult, PostHogConfig } from "posthog-js";
import { scrubEvent, scrubText } from "./scrub";

/**
 * 리버스 프록시 경로. **상수다**(환경변수로 바꾸지 않는다).
 * next.config 의 rewrites 와 proxy.ts 의 공개 경로 목록이 같은 값을 봐야 하므로
 * 런타임 설정으로 열어두면 어긋날 수 있다. 바꾸려면 이 상수 하나만 고친다.
 */
export const ANALYTICS_PROXY_PATH = "/ingest";

/** PostHog 클라우드 기본 리전. 자체 호스팅이면 NEXT_PUBLIC_POSTHOG_HOST 로 덮는다. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/** 프로젝트 API 키(공개 키)의 형태. 값이 아니라 형태만 검사한다. */
const PROJECT_KEY_SHAPE = /^phc_[A-Za-z0-9]{20,}$/;

export type AnalyticsEnvInput = {
  key?: string;
  host?: string;
};

export type AnalyticsConfig = {
  /** 프로젝트 공개 키. 로그로 출력하지 않는다. */
  projectKey: string;
  /** 이벤트 전송 경로 — 항상 자기 도메인(프록시). */
  apiHost: string;
  /** PostHog 원본 호스트. "PostHog 에서 보기" 링크와 rewrites 대상. */
  uiHost: string;
};

/** 호스트 문자열을 정규화한다. https 절대 URL 이 아니면 null(→ 기본값 사용). */
function normalizeHost(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

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
    uiHost: normalizeHost(input.host) ?? DEFAULT_POSTHOG_HOST,
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
export const REPLAY_BLOCK_SELECTOR = "[data-mw-no-record]";

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
 *  - `autocapture`: 켜되 텍스트·속성은 전부 마스킹한다. 클릭 구조는 얻고 내용은 안 보낸다.
 *  - `capture_pageview: false`: App Router 의 라우팅은 SDK history 감지와 어긋난다. 직접 보낸다.
 *  - `person_profiles: "identified_only"`: 익명 방문자 프로필을 만들지 않는다.
 *  - `respect_dnt`: 브라우저 Do Not Track 을 존중한다.
 *  - `before_send`: 전송 직전 마지막 스크러빙. (구버전 `sanitize_properties` 는 deprecated 라 쓰지 않는다.)
 */
export function buildPostHogOptions(
  config: AnalyticsConfig,
): Partial<PostHogConfig> {
  return {
    api_host: config.apiHost,
    ui_host: config.uiHost,
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    person_profiles: "identified_only",
    persistence: "localStorage+cookie",
    respect_dnt: true,
    disable_surveys: true,
    session_recording: buildSessionRecordingConfig(),
    before_send: (event: CaptureResult | null) => scrubEvent(event),
  };
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
