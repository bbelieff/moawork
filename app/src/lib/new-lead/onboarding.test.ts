import { describe, expect, it } from "vitest";
import { loadNewLeadOnboardingState, parseNewLeadOnboardingState } from "./onboarding";

describe("Issue #542 new lead onboarding state", () => {
  it("accepts only durable completed or dismissed states", () => {
    expect(parseNewLeadOnboardingState("completed")).toBe("completed");
    expect(parseNewLeadOnboardingState("dismissed")).toBe("dismissed");
    expect(parseNewLeadOnboardingState("unexpected")).toBeNull();
  });

  it("fails closed when the RPC is unavailable or malformed", async () => {
    expect(await loadNewLeadOnboardingState(null, "org-a")).toEqual({ available: false, state: null });
    expect(await loadNewLeadOnboardingState({ rpc: async () => ({ data: null, error: { code: "42501" } }) }, "org-a"))
      .toEqual({ available: false, state: null });
    expect(await loadNewLeadOnboardingState({ rpc: async () => ({ data: [{ state: "admin" }], error: null }) }, "org-a"))
      .toEqual({ available: false, state: null });
    expect(await loadNewLeadOnboardingState({ rpc: async () => ({ data: [], error: null }) }, "org-a"))
      .toEqual({ available: true, state: null });
  });
});
