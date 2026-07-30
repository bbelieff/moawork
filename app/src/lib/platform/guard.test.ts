import { describe, expect, it } from "vitest";
import { resolvePlatformAccess } from "./guard";

describe("resolvePlatformAccess", () => {
  it("allows only a server-confirmed platform administrator", () => {
    expect(resolvePlatformAccess({ kind: "granted" })).toEqual({ kind: "allowed" });
    expect(resolvePlatformAccess({ kind: "denied", reason: "not_platform" })).toEqual({ kind: "denied", reason: "permission" });
  });

  it("keeps unauthenticated, unavailable, and ordinary actors fail-closed", () => {
    expect(resolvePlatformAccess({ kind: "denied", reason: "unauthenticated" })).toEqual({ kind: "denied", reason: "unauthenticated" });
    expect(resolvePlatformAccess({ kind: "unavailable" })).toEqual({ kind: "denied", reason: "unavailable" });
  });
});
