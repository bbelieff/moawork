import { describe, expect, it } from "vitest";
import { ANALYTICS_PROXY_PATH, DEFAULT_POSTHOG_HOST } from "./config";
import { assetsHostFor, posthogRewrites } from "./rewrites";

describe("assetsHostFor", () => {
  it("PostHog 클라우드는 리전별 assets 호스트로 바꾼다", () => {
    expect(assetsHostFor("https://us.i.posthog.com")).toBe("https://us-assets.i.posthog.com");
    expect(assetsHostFor("https://eu.i.posthog.com")).toBe("https://eu-assets.i.posthog.com");
  });

  it("자체 호스팅은 같은 호스트가 자산도 서빙한다", () => {
    expect(assetsHostFor("https://ph.example.invalid")).toBe("https://ph.example.invalid");
  });

  it("파싱 불가 값은 그대로 돌려준다", () => {
    expect(assetsHostFor("not a url")).toBe("not a url");
  });
});

describe("posthogRewrites", () => {
  it("static 규칙이 catch-all 보다 먼저 온다", () => {
    const rules = posthogRewrites();
    expect(rules.map((r) => r.source)).toEqual([
      `${ANALYTICS_PROXY_PATH}/static/:path*`,
      `${ANALYTICS_PROXY_PATH}/:path*`,
    ]);
  });

  it("호스트 미지정이면 기본 리전으로 보낸다", () => {
    const rules = posthogRewrites();
    expect(rules[0].destination).toBe("https://us-assets.i.posthog.com/static/:path*");
    expect(rules[1].destination).toBe(`${DEFAULT_POSTHOG_HOST}/:path*`);
  });

  it("https 호스트를 지정하면 그쪽으로 보낸다", () => {
    const rules = posthogRewrites("https://eu.i.posthog.com");
    expect(rules[0].destination).toBe("https://eu-assets.i.posthog.com/static/:path*");
    expect(rules[1].destination).toBe("https://eu.i.posthog.com/:path*");
  });

  it("경로·쿼리가 붙어도 origin 만 쓴다", () => {
    const rules = posthogRewrites("https://eu.i.posthog.com/some/path?x=1");
    expect(rules[1].destination).toBe("https://eu.i.posthog.com/:path*");
  });

  it.each(["http://eu.i.posthog.com", "ftp://x", "//eu.i.posthog.com", "  ", "garbage"])(
    "https 가 아닌 값(%s)은 기본값으로 떨어진다",
    (host) => {
      expect(posthogRewrites(host)[1].destination).toBe(`${DEFAULT_POSTHOG_HOST}/:path*`);
    },
  );

  it("전송 목적지는 언제나 https 다", () => {
    for (const host of [undefined, "https://eu.i.posthog.com", "bogus"]) {
      for (const rule of posthogRewrites(host)) {
        expect(rule.destination.startsWith("https://")).toBe(true);
      }
    }
  });
});
