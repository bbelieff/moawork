import { describe, expect, it } from "vitest";
import {
  planFeatureFlagTransition,
  resolveFeatureFlagStage,
  validateFeatureFlagDefinition,
} from "./control";

describe("feature flag rollout control", () => {
  it("defaults a missing release to off and rejects stable without canary", () => {
    expect(resolveFeatureFlagStage({ canary: false, stable: false })).toBe("off");
    expect(resolveFeatureFlagStage({ canary: false, stable: true })).toBeNull();
  });

  it("permits only off to canary to stable", () => {
    expect(planFeatureFlagTransition({ canary: false, stable: false }, "canary")?.mutations)
      .toEqual([{ ring: "canary", enabled: true }]);
    expect(planFeatureFlagTransition({ canary: true, stable: false }, "stable")?.mutations)
      .toEqual([{ ring: "stable", enabled: true }]);
    expect(planFeatureFlagTransition({ canary: false, stable: false }, "stable")).toBeNull();
  });

  it("makes emergency off explicit for both rings", () => {
    expect(planFeatureFlagTransition({ canary: true, stable: true }, "off")?.mutations)
      .toEqual([
        { ring: "stable", enabled: false },
        { ring: "canary", enabled: false },
      ]);
  });

  it("requires a valid owner and a future removal deadline", () => {
    const now = new Date("2026-08-10T00:00:00Z");
    expect(validateFeatureFlagDefinition({
      key: "workspace.new-board",
      owner: "team.workspace",
      removalDueAt: "2026-09-10T00:00:00Z",
    }, now)).toEqual([]);
    expect(validateFeatureFlagDefinition({
      key: "Bad key",
      owner: "",
      removalDueAt: "2026-08-01T00:00:00Z",
    }, now)).toEqual([
      "feature_key_invalid",
      "owner_invalid",
      "removal_due_at_expired",
    ]);
  });
});
