import type { NextConfig } from "next";
import { join } from "node:path";
// `@/` 별칭은 next.config 에서 해석되지 않는다 — 상대경로로 읽는다.
// 이 모듈은 런타임 의존성이 없다(SDK 는 type-only import).
import { posthogRewrites } from "./src/lib/analytics/rewrites";
import {
  resolveBuildSha,
  resolveNextDeploymentId,
  serverActionsKeyFingerprint,
} from "./src/lib/operations/runtime-identity";

const buildSha = resolveBuildSha(process.env);
const serverActionsBuildFingerprint = serverActionsKeyFingerprint(
  process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,
);

if (process.env.MOAWORK_BUILD_SHA && !buildSha) {
  // 값 자체는 출력하지 않는다. CI 설정 오류를 산출물 생성 전에 차단한다.
  throw new Error("Build revision must be a full 40-character Git SHA.");
}

if (process.env.MOAWORK_BUILD_SHA && !serverActionsBuildFingerprint) {
  throw new Error(
    "Self-hosted builds require a canonical Server Actions encryption key.",
  );
}

const nextConfig: NextConfig = {
  // Issue #725 — 한 번 검증한 standalone 산출물을 shadow/blue/green에 재사용한다.
  output: "standalone",
  // #725: preserve 127.0.0.1 in request.url so internal proxy rewrites match
  // the standalone router's original origin instead of becoming external hops.
  skipProxyUrlNormalize: true,
  // npm workspace의 hoisted production dependency까지 standalone trace에 포함한다.
  outputFileTracingRoot: join(process.cwd(), ".."),
  // Server Action 요청과 브라우저 asset이 서로 다른 release로 섞이지 않게 한다.
  // 자체 호스팅은 exact commit SHA를 쓴다. source/release SHA 검증은 별개다.
  deploymentId: resolveNextDeploymentId(process.env),
  // This non-secret HMAC is compiled into the exact build and copied into
  // required-server-files.json. Runtime readiness and artifact provenance use
  // it to prove that Next consumed the same Server Actions key at build time.
  env: {
    ...(serverActionsBuildFingerprint
      ? {
          MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT:
            serverActionsBuildFingerprint,
        }
      : {}),
  },
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
   *   아이템 파일 상한 10 MiB + multipart 오버헤드 < 여기 16 MB
   * 자체 호스팅 프록시의 외곽 상한도 같은 16 MB로 검증해야 한다.
   */
  experimental: {
    serverActions: { bodySizeLimit: "16mb" },
  },
  async rewrites() {
    return posthogRewrites();
  },
};

export default nextConfig;
