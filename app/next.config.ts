import type { NextConfig } from "next";
// `@/` 별칭은 next.config 에서 해석되지 않는다 — 상대경로로 읽는다.
// 이 모듈은 런타임 의존성이 없다(SDK 는 type-only import).
import { posthogRewrites } from "./src/lib/analytics/rewrites";

const nextConfig: NextConfig = {
  // PostHog 리버스 프록시(/ingest/*). 근거는 src/lib/analytics/rewrites.ts 주석 참고.
  // 수집 엔드포인트는 후행 슬래시 유무에 민감해서 Next 의 자동 리다이렉트를 끈다.
  skipTrailingSlashRedirect: true,
  /*
   * #652 — 서버 액션 본문 상한.
   *
   * ★ 기본값이 1 MB 인데 회사 로고 상한도 1 MB 였다. 그래서 조금이라도 큰 파일은
   *   **우리 코드가 실행되기 전에** 요청이 잘렸고, 「파일이 너무 커요」라는 안내조차 못 떴다 —
   *   사용자 눈에는 «올렸는데 아무 일도 안 일어남» 이었다. 로고가 한 번도 안 올라간
   *   이유 셋 중 하나다.
   *
   * 그래서 «우리 상한보다 넉넉히» 둔다. 그래야 큰 파일이 와도 우리 문구가 먼저 말한다.
   *   로고 상한 4 MB (ORG_LOGO_MAX_BYTES) < 여기 6 MB
   */
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
  },
  async rewrites() {
    return posthogRewrites();
  },
};

export default nextConfig;
