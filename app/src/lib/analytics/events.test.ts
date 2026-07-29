import { describe, expect, it } from "vitest";
import {
  ALLOWED_EVENTS,
  CUSTOM_EVENTS,
  SDK_EVENTS,
  analyticsRouteTemplate,
  isAllowedEvent,
  loginFailureReason,
  type AnalyticsEventPayloads,
} from "./events";
import {
  REPLAY_BLOCK_SELECTOR,
  REPLAY_EXCLUDED_PATH_PREFIXES,
  buildSessionRecordingConfig,
  gateAndScrub,
  isReplayExcludedPath,
} from "./config";
import { REDACTED } from "./scrub";

describe("Wave B event allowlist", () => {
  it("contains only four product events and masked replay/pageview SDK events", () => {
    expect(CUSTOM_EVENTS).toEqual([
      "login_result",
      "workspace_entry_state",
      "workspace_request_result",
      "first_workspace_entered",
    ]);
    expect(SDK_EVENTS).toEqual(["$pageview", "$snapshot"]);
    expect(ALLOWED_EVENTS).toHaveLength(6);
    expect(new Set(ALLOWED_EVENTS).size).toBe(6);
  });

  it("drops every unknown or automatic event", () => {
    for (const name of ["$autocapture", "$pageleave", "$identify", "$set", "$exception", "deal_created", "search"] ) {
      expect(isAllowedEvent(name)).toBe(false);
      expect(gateAndScrub({ event: name })).toBeNull();
    }
  });

  it("allows every reviewed event", () => {
    for (const name of ALLOWED_EVENTS) expect(gateAndScrub({ event: name })).not.toBeNull();
  });
});

describe("PII-free categorical payload contract", () => {
  const samples: { [E in keyof AnalyticsEventPayloads]: AnalyticsEventPayloads[E] } = {
    login_result: { outcome: "failure", reason: "auth_callback" },
    workspace_entry_state: { state: "pending" },
    workspace_request_result: { kind: "join", outcome: "success" },
    first_workspace_entered: { entry: "canonical" },
  };

  it("has a sample for every product event", () => {
    expect(Object.keys(samples).sort()).toEqual([...CUSTOM_EVENTS].sort());
  });

  it("uses only short enums and has no PII/search/query/id fields", () => {
    const forbidden = ["name", "company", "email", "search", "query", "slug", "customer", "id", "url"];
    for (const payload of Object.values(samples)) {
      for (const [key, value] of Object.entries(payload)) {
        expect(forbidden.some((part) => key.toLowerCase().includes(part))).toBe(false);
        if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(32);
      }
    }
  });

  it("scrubs PII even when an untyped caller bypasses the contract", () => {
    const out = gateAndScrub({
      event: "login_result",
      properties: { outcome: "failure", customer_name: "테스트 고객", email: "member@example.invalid" },
    });
    expect(out?.properties).toEqual({ outcome: "failure", customer_name: REDACTED, email: REDACTED });
  });
});

describe("pathname templates and safe login enums", () => {
  it.each([
    ["/w/acme?search=private", "/w/:workspace"],
    ["/boards/secret-board", "/boards/:board"],
    ["/deals/customer-record", "/deals/:deal"],
    ["/dash/pipeline-123", "/dash/:view"],
    ["/unknown/customer-name", "/other"],
  ])("normalizes %s without dynamic values", (input, expected) => {
    expect(analyticsRouteTemplate(input)).toBe(expected);
  });

  it("maps raw login query values to bounded categories", () => {
    expect(loginFailureReason("auth")).toBe("auth_callback");
    expect(loginFailureReason("config")).toBe("configuration");
    expect(loginFailureReason("private-value")).toBe("unknown");
    expect(loginFailureReason(null)).toBeNull();
  });
});

describe("session replay masking", () => {
  const cfg = buildSessionRecordingConfig();

  it("masks all text and inputs and blocks explicit PII nodes", () => {
    expect(cfg?.maskAllInputs).toBe(true);
    expect(cfg?.maskTextSelector).toBe("*");
    expect(REPLAY_BLOCK_SELECTOR).toContain("[data-pii]");
    expect(cfg?.blockSelector).toContain("[data-pii]");
  });

  it("keeps fonts and cross-origin iframes out", () => {
    expect(cfg?.collectFonts).toBe(false);
    expect(cfg?.recordCrossOriginIframes).toBe(false);
  });

  it("excludes account, hometax, and settlement routes with path boundaries", () => {
    expect(REPLAY_EXCLUDED_PATH_PREFIXES).toEqual(expect.arrayContaining(["/account", "/settings/account", "/hometax", "/settlements"]));
    expect(isReplayExcludedPath("/settings/account/sessions")).toBe(true);
    expect(isReplayExcludedPath("/hometax/invoices/1")).toBe(true);
    expect(isReplayExcludedPath("/accounts")).toBe(false);
  });
});
