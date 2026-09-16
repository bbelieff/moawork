import { describe, expect, it } from "vitest";
import { isUnconfiguredSupporterStatus } from "./contracts";

describe("isUnconfiguredSupporterStatus", () => {
  it("accepts exactly the server metadata shape", () => {
    expect(
      isUnconfiguredSupporterStatus({
        status: { kind: "unavailable", reason: "not_configured" },
      }),
    ).toBe(true);
  });

  it("rejects malformed 200 bodies, HTML fallbacks, and padded shapes", () => {
    for (const body of [
      null,
      undefined,
      "ok",
      "<html>login</html>",
      {},
      { status: null },
      { status: "unavailable" },
      { status: { kind: "unavailable" } },
      { status: { kind: "unavailable", reason: "other" } },
      { status: { kind: "ready", reason: "not_configured" } },
      {
        status: {
          kind: "unavailable",
          reason: "not_configured",
          granted: true,
        },
      },
      { status: { kind: "unavailable", reason: "not_configured" }, extra: 1 },
    ]) {
      expect(isUnconfiguredSupporterStatus(body)).toBe(false);
    }
  });
});
