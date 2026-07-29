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

/**
 * PostHog 클라우드는 이벤트 수집과 정적 자산(recorder 번들 등) 호스트가 다르다.
 *   https://us.i.posthog.com  →  https://us-assets.i.posthog.com
 * 자체 호스팅처럼 규칙에 맞지 않는 호스트는 그대로 쓴다(같은 호스트가 둘 다 서빙).
 */
export function assetsHostFor(apiHost: string): string {
  try {
    const url = new URL(apiHost);
    const match = url.hostname.match(/^([a-z0-9-]+)\.i\.posthog\.com$/);
    if (!match) return apiHost;
    return `https://${match[1]}-assets.i.posthog.com`;
  } catch {
    return apiHost;
  }
}

/**
 * rewrites 배열. 순서가 의미를 갖는다 — `/static/*` 이 catch-all 보다 먼저 와야 한다.
 * 호스트가 비었거나 https 가 아니면 기본 리전으로 떨어진다(설정 실수로 평문 전송 금지).
 */
export function posthogRewrites(host?: string): Rewrite[] {
  let apiHost = DEFAULT_POSTHOG_HOST;
  const candidate = host?.trim();
  if (candidate) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:") apiHost = url.origin;
    } catch {
      // 형태가 잘못된 값은 무시하고 기본값을 쓴다. 값 자체는 로그에 남기지 않는다.
    }
  }

  return [
    {
      source: `${ANALYTICS_PROXY_PATH}/static/:path*`,
      destination: `${assetsHostFor(apiHost)}/static/:path*`,
    },
    {
      source: `${ANALYTICS_PROXY_PATH}/:path*`,
      destination: `${apiHost}/:path*`,
    },
  ];
}
