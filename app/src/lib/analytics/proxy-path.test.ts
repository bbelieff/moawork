// 프록시 경로 동기화 계약.
//
// 프록시 경로는 세 곳에 나타난다:
//   1. lib/analytics/config.ts  — ANALYTICS_PROXY_PATH (단일 출처)
//   2. lib/analytics/rewrites.ts — next.config 의 rewrites source
//   3. app/src/proxy.ts          — matcher 제외 패턴 (Next 가 정적으로 읽어 상수를 못 넣는다)
//
// 3번이 상수를 참조할 수 없으므로 값이 어긋나도 컴파일은 통과한다. 그러면 수집 요청이
// 인증 게이트에 걸려 **미인증 화면의 이벤트가 통째로 사라지거나**, 매 비콘마다
// 세션 검증 왕복이 붙는다. 둘 다 조용히 일어난다 — 그래서 테스트로 고정한다.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANALYTICS_PROXY_PATH } from "./config";
import { posthogRewrites } from "./rewrites";
import { config as proxyConfig } from "../../proxy";

const proxySource = readFileSync(
  fileURLToPath(new URL("../../proxy.ts", import.meta.url)),
  "utf8",
);

/** "/mw-sig" → "mw-sig" (matcher 패턴에는 선행 슬래시 없이 들어간다) */
const bare = ANALYTICS_PROXY_PATH.replace(/^\//, "");

describe("프록시 경로 — 이름 선택", () => {
  it("차단 목록에 흔히 오르는 이름을 쓰지 않는다", () => {
    // 프록시를 두는 목적이 차단 회피이므로, 용도가 드러나는 이름은 의미가 없다.
    // `/ingest` 는 PostHog 공식 문서의 대표 예시라 함께 제외한다.
    const obvious = [
      "/analytics",
      "/tracking",
      "/track",
      "/telemetry",
      "/posthog",
      "/ingest",
      "/collect",
      "/stats",
      "/metrics",
      "/events",
    ];
    expect(obvious).not.toContain(ANALYTICS_PROXY_PATH);
  });

  it("경로 형태가 단순하다(선행 슬래시 1개 · 소문자 · 하위경로 없음)", () => {
    expect(ANALYTICS_PROXY_PATH).toMatch(/^\/[a-z0-9-]+$/);
  });
});

describe("프록시 경로 — 세 지점 동기화", () => {
  it("rewrites 의 source 가 상수를 따른다", () => {
    const rewrites = posthogRewrites();
    expect(rewrites[0].source).toBe(`${ANALYTICS_PROXY_PATH}/static/:path*`);
    expect(rewrites[1].source).toBe(`${ANALYTICS_PROXY_PATH}/:path*`);
  });

  it("proxy.ts matcher 가 같은 경로를 인증 게이트에서 제외한다", () => {
    const matcher = proxyConfig.matcher.join("\n");
    expect(matcher).toContain(`${bare}(?:/|$)`);
  });

  it("matcher 에 옛 경로가 남아 있지 않다", () => {
    const matcher = proxyConfig.matcher.join("\n");
    expect(matcher).not.toContain("ingest");
  });

  it("proxy.ts 주석의 경로 표기도 상수와 일치한다(문서 드리프트 방지)", () => {
    expect(proxySource).toContain(`${ANALYTICS_PROXY_PATH}/*`);
  });
});

describe("프록시 경로 — 인증 게이트 실제 동작", () => {
  /** matcher 정규식은 `/(...)` 형태다. 실제 경로가 걸리는지 직접 판정한다. */
  function isGated(pathname: string): boolean {
    return proxyConfig.matcher.some((pattern) =>
      new RegExp(`^${pattern}$`).test(pathname),
    );
  }

  it("수집 경로는 인증 게이트를 타지 않는다", () => {
    expect(isGated(`${ANALYTICS_PROXY_PATH}`)).toBe(false);
    expect(isGated(`${ANALYTICS_PROXY_PATH}/e`)).toBe(false);
    expect(isGated(`${ANALYTICS_PROXY_PATH}/static/recorder.js`)).toBe(false);
  });

  it("이름이 비슷한 앱 경로는 여전히 게이트를 탄다(경계 확인)", () => {
    expect(isGated(`${ANALYTICS_PROXY_PATH}nal`)).toBe(true);
    expect(isGated("/dash")).toBe(true);
  });
});

describe("리전 — US 고정", () => {
  it("rewrites 목적지가 US 리전이다(EU 로 바뀌지 않았다)", () => {
    const rewrites = posthogRewrites();
    expect(rewrites[1].destination).toContain("us.i.posthog.com");
    for (const r of rewrites) {
      expect(r.destination).not.toContain("eu.i.posthog.com");
      expect(r.destination.startsWith("https://")).toBe(true);
    }
  });

  it("정적 자산은 assets 호스트로 간다", () => {
    expect(posthogRewrites()[0].destination).toContain("us-assets.i.posthog.com");
  });
});
