import { describe, expect, it } from "vitest";
import {
  ALLOWED_EVENTS,
  ASSIGNED_EVENTS,
  CUSTOM_EVENTS,
  SDK_EVENTS,
  WAVE_B_EVENTS,
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
  it("keeps the four already-wired Wave B events (renaming them breaks live call sites)", () => {
    expect(WAVE_B_EVENTS).toEqual([
      "login_result",
      "workspace_entry_state",
      "workspace_request_result",
      "first_workspace_entered",
    ]);
    expect(SDK_EVENTS).toEqual(["$pageview", "$snapshot"]);
  });

  it("adds the ten assigned events on top - 14 custom + 2 SDK", () => {
    expect(ASSIGNED_EVENTS).toEqual([
      "auth.login.succeeded",
      "org.workspace.switched",
      "crm.deal.created",
      "crm.deal.stage_changed",
      "settle.settlement.saved",
      "board.column.created",
      "support.thread.opened",
      "support.grant.approved",
      "admin.console.viewed",
      "admin.breakglass.started",
    ]);
    expect(CUSTOM_EVENTS).toHaveLength(14);
    expect(ALLOWED_EVENTS).toHaveLength(16);
    expect(new Set(ALLOWED_EVENTS).size).toBe(16);
  });

  it("assigned events follow the naming rule (area.target.action)", () => {
    for (const name of ASSIGNED_EVENTS) {
      expect(name, name).toMatch(/^[a-z]+\.[a-z_]+\.[a-z_]+$/);
    }
  });

  it("$snapshot stays allowed - dropping it kills session replay entirely", () => {
    expect(isAllowedEvent("$snapshot")).toBe(true);
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

const UUID_A = "11111111-2222-3333-4444-555555555555";
const UUID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("PII-free categorical payload contract", () => {
  const samples: { [E in keyof AnalyticsEventPayloads]: AnalyticsEventPayloads[E] } = {
    login_result: { outcome: "failure", reason: "auth_callback" },
    workspace_entry_state: { state: "pending" },
    workspace_request_result: { kind: "join", outcome: "success" },
    first_workspace_entered: { entry: "canonical" },
    "auth.login.succeeded": { method: "google", duration_ms: 320 },
    "org.workspace.switched": { to_org_id: UUID_A, from_org_id: UUID_B },
    "crm.deal.created": { deal_id: UUID_A, pipeline_id: UUID_B, stage_id: UUID_B, source: "board" },
    "crm.deal.stage_changed": { deal_id: UUID_A, from_stage_id: UUID_B, to_stage_id: UUID_A },
    "settle.settlement.saved": { settlement_id: UUID_A, deal_id: UUID_B, mode: "create" },
    "board.column.created": { board_id: UUID_A, column_id: UUID_B, column_type: "status" },
    "support.thread.opened": { thread_id: UUID_A, category: "billing" },
    "support.grant.approved": { grant_id: UUID_A, target_org_id: UUID_B, ttl_minutes: 60 },
    "admin.console.viewed": { section: "orgs" },
    "admin.breakglass.started": { reason_code: "incident", target_org_id: UUID_B, ttl_minutes: 30 },
  };

  it("has a sample for every product event", () => {
    expect(Object.keys(samples).sort()).toEqual([...CUSTOM_EVENTS].sort());
  });

  it("Wave B payloads carry no ids at all (original stricter rule kept)", () => {
    const forbidden = ["name", "company", "email", "search", "query", "slug", "customer", "id", "url"];
    for (const event of WAVE_B_EVENTS) {
      const payload = samples[event] as Record<string, unknown>;
      for (const [key, value] of Object.entries(payload)) {
        expect(forbidden.some((part) => key.toLowerCase().includes(part)), key).toBe(false);
        if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(32);
      }
    }
  });

  it("assigned payloads allow internal UUIDs but no human-readable PII", () => {
    // Assignment allows internal UUIDs, role, path, duration, success/failure, error code.
    // So *_id is permitted but must be a UUID; human-readable fields stay banned.
    const forbidden = ["name", "company", "email", "phone", "address", "amount", "fee",
                       "search", "query", "slug", "customer", "memo", "note", "title", "url"];
    for (const event of ASSIGNED_EVENTS) {
      const payload = samples[event] as Record<string, unknown>;
      for (const [key, value] of Object.entries(payload)) {
        expect(forbidden.some((part) => key.toLowerCase().includes(part)), event + "." + key).toBe(false);
        if (key.endsWith("_id")) {
          expect(typeof value === "string" && UUID_RE.test(value as string), event + "." + key).toBe(true);
        } else if (typeof value === "string") {
          expect(value.length, event + "." + key).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  it("no assigned payload has a field for money", () => {
    const money = ["amount", "fee", "commission", "revenue", "price", "principal", "deposit"];
    for (const event of ASSIGNED_EVENTS) {
      for (const key of Object.keys(samples[event] as Record<string, unknown>)) {
        expect(money.some((m) => key.toLowerCase().includes(m)), event + "." + key).toBe(false);
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
