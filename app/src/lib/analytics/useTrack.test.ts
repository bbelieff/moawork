import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PostHog } from "posthog-js";
import { setAnalyticsInstance } from "./client";
import { track } from "./useTrack";

type Sent = { event: string; properties?: Record<string, unknown> };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  setAnalyticsInstance({
    capture: (event: string, properties?: Record<string, unknown>) => sent.push({ event, properties }),
  } as unknown as PostHog);
});

afterEach(() => setAnalyticsInstance(null));

describe("Wave B categorical event delivery", () => {
  it("sends login outcome without identity fields", () => {
    track("login_result", { outcome: "failure", reason: "auth_callback" });
    expect(sent).toEqual([{ event: "login_result", properties: { app_version: "dev", outcome: "failure", reason: "auth_callback" } }]);
  });

  it("sends create/join request result as enums only", () => {
    track("workspace_request_result", { kind: "join", outcome: "success" });
    expect(sent[0].properties).toEqual({ app_version: "dev", kind: "join", outcome: "success" });
  });

  it("drops undefined optional fields", () => {
    track("login_result", { outcome: "success", reason: undefined });
    expect(sent[0].properties).toEqual({ app_version: "dev", outcome: "success" });
  });
});

describe("allowlist and fail-open", () => {
  it("drops an untyped unknown event", () => {
    (track as unknown as (event: string, payload: object) => void)("search", { query: "private" });
    expect(sent).toHaveLength(0);
  });

  it("does not throw without an analytics instance", () => {
    setAnalyticsInstance(null);
    expect(() => track("workspace_entry_state", { state: "chooser" })).not.toThrow();
  });
});
