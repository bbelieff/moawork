import type { NextConfig } from "next";
// `@/` 별칭은 next.config 에서 해석되지 않는다 — 상대경로로 읽는다.
// 이 모듈은 런타임 의존성이 없다(SDK 는 type-only import).
import { posthogRewrites } from "./src/lib/analytics/rewrites";

const nextConfig: NextConfig = {
  // PostHog 리버스 프록시(/ingest/*). 근거는 src/lib/analytics/rewrites.ts 주석 참고.
  // 수집 엔드포인트는 후행 슬래시 유무에 민감해서 Next 의 자동 리다이렉트를 끈다.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return posthogRewrites();
  },
};

export default nextConfig;
