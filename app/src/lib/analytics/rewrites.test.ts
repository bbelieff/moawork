import { describe, expect, it } from "vitest";
import { ANALYTICS_PROXY_PATH, DEFAULT_POSTHOG_HOST } from "./config";
import { POSTHOG_US_ASSETS_HOST, posthogRewrites } from "./rewrites";

describe("posthogRewrites — Wave B US lock", () => {
  it("puts the static rule before catch-all", () => {
    expect(posthogRewrites().map((rule) => rule.source)).toEqual([
      `${ANALYTICS_PROXY_PATH}/static/:path*`,
      `${ANALYTICS_PROXY_PATH}/:path*`,
    ]);
  });

  it("has only fixed PostHog US destinations", () => {
    expect(posthogRewrites()).toEqual([
      {
        source: `${ANALYTICS_PROXY_PATH}/static/:path*`,
        destination: `${POSTHOG_US_ASSETS_HOST}/static/:path*`,
      },
      {
        source: `${ANALYTICS_PROXY_PATH}/:path*`,
        destination: `${DEFAULT_POSTHOG_HOST}/:path*`,
      },
    ]);
  });

  it("exposes no host override parameter", () => {
    expect(posthogRewrites.length).toBe(0);
    for (const rule of posthogRewrites()) {
      expect(rule.destination.startsWith("https://us-") || rule.destination.startsWith("https://us.")).toBe(true);
    }
  });
});
