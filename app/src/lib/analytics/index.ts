// 분석(PostHog) 공개 표면. 다른 트랙은 이 배럴만 import 한다.
// `posthog-js` 직접 import 금지 — 스크러빙·마스킹 설정을 우회하게 된다.

export {
  ANALYTICS_PROXY_PATH,
  DEFAULT_POSTHOG_HOST,
  REPLAY_BLOCK_SELECTOR,
  REPLAY_EXCLUDED_PATH_PREFIXES,
  buildIdentifyProperties,
  buildPostHogOptions,
  buildSessionRecordingConfig,
  gateAndScrub,
  isReplayExcludedPath,
  resolveAnalyticsConfig,
  type AnalyticsConfig,
  type AnalyticsEnvInput,
} from "./config";

export {
  ALLOWED_EVENTS,
  CUSTOM_EVENTS,
  SDK_EVENTS,
  isAllowedEvent,
  type AnalyticsEventPayloads,
  type CustomEventName,
  type EventPropertyValue,
} from "./events";

export { track, useTrack, type TrackFn } from "./useTrack";

export { getAnalyticsConfig, isAnalyticsEnabled, readAnalyticsEnv } from "./env";

export { assetsHostFor, posthogRewrites, type Rewrite } from "./rewrites";

export {
  REDACTED,
  isSensitiveKey,
  scrubEvent,
  scrubProperties,
  scrubText,
  scrubUrl,
  scrubValue,
  type ScrubbableEvent,
} from "./scrub";
