import { describe, expect, it } from "vitest";
import {
  decidePlatformAccessDestination,
  resolvePlatformAccess,
} from "./guard";

describe("resolvePlatformAccess", () => {
  it("allows only a server-confirmed platform administrator", () => {
    expect(resolvePlatformAccess({ kind: "granted" })).toEqual({ kind: "allowed" });
    expect(resolvePlatformAccess({ kind: "denied", reason: "not_platform" })).toEqual({ kind: "denied", reason: "permission" });
  });

  it("keeps unauthenticated, unavailable, and ordinary actors fail-closed", () => {
    expect(resolvePlatformAccess({ kind: "denied", reason: "unauthenticated" })).toEqual({ kind: "denied", reason: "unauthenticated" });
    expect(resolvePlatformAccess({ kind: "unavailable" })).toEqual({ kind: "denied", reason: "unavailable" });
  });

  it("preserves a safe return path only for unauthenticated actors", () => {
    expect(decidePlatformAccessDestination(
      { kind: "denied", reason: "unauthenticated" },
      "/platform/organizations?tab=active",
    )).toEqual({
      kind: "authenticate",
      path: "/login?next=%2Fplatform%2Forganizations%3Ftab%3Dactive",
    });
  });

  it.each(["https://attacker.invalid", "/login", "/auth/callback"])(
    "sanitizes unsafe or looping platform return path %s",
    (nextPath) => {
      expect(decidePlatformAccessDestination(
        { kind: "denied", reason: "unauthenticated" },
        nextPath,
      )).toEqual({
        kind: "authenticate",
        path: "/login?next=%2Fworkspace-entry",
      });
    },
  );

  it("converges forbidden and unavailable outcomes without changing allowed actors", () => {
    expect(decidePlatformAccessDestination({ kind: "allowed" }, "/platform")).toBeNull();
    expect(decidePlatformAccessDestination(
      { kind: "denied", reason: "permission" },
      "/platform",
    )).toEqual({ kind: "fail-closed", path: "/workspace-entry?error=routing" });
    expect(decidePlatformAccessDestination(
      { kind: "denied", reason: "unavailable" },
      "/platform",
    )).toEqual({ kind: "fail-closed", path: "/workspace-entry?error=routing" });
  });
});
