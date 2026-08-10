// PostHog 리버스 프록시 — next.config 의 rewrites 를 만든다.
//
// 왜 프록시인가
//  1. 광고/추적 차단기가 `*.i.posthog.com` 를 막는다. 자기 도메인으로 받으면 통과한다.
//  2. 브라우저가 3rd-party 로 직접 요청하지 않는다 → 쿠키 정책·CSP 표면이 단순해진다.
//  3. 요청 경로가 우리 도메인 안에 있으므로 접근 경계(proxy.ts)를 우리가 통제한다.
//
// ⚠ 여기 정의한 경로는 `app/src/proxy.ts` 의 공개 경로 목록과 **반드시** 함께 움직인다.
//    로그인 화면에서도 이벤트가 나가야 하므로 인증 게이트에 걸리면 안 된다.
//
// next.config.ts 가 상대경로로 import 한다 — `@/` 별칭을 쓰지 않는다.

import { ANALYTICS_PROXY_PATH, DEFAULT_POSTHOG_HOST } from "./config";

export type Rewrite = { source: string; destination: string };

export const POSTHOG_US_ASSETS_HOST = "https://us-assets.i.posthog.com";

/**
 * rewrites 배열. 순서가 의미를 갖는다 — `/static/*` 이 catch-all 보다 먼저 와야 한다.
 * 목적지는 Wave B 승인값인 US 리전 두 호스트로 고정한다.
 */
export function posthogRewrites(): Rewrite[] {
  return [
    {
      source: `${ANALYTICS_PROXY_PATH}/static/:path*`,
      destination: `${POSTHOG_US_ASSETS_HOST}/static/:path*`,
    },
    {
      source: `${ANALYTICS_PROXY_PATH}/:path*`,
      destination: `${DEFAULT_POSTHOG_HOST}/:path*`,
    },
  ];
}
