import { describe, expect, it } from "vitest";
import { loadPlatformActor, resolvePlatformActor, type PlatformActorClient } from "./actor";

const user = { id: "synthetic-platform-actor" };
const result = (userValue: unknown | null, userError: unknown | null, grantValue?: unknown, grantError: unknown | null = null) =>
  resolvePlatformActor({ data: { user: userValue }, error: userError }, grantValue === undefined ? undefined : { data: grantValue, error: grantError });

function client(grantValue: unknown, grantError: unknown | null = null): PlatformActorClient {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async () => ({ data: grantValue, error: grantError }),
  };
}

describe("platform actor boundary", () => {
  it("grants only an authenticated, server-confirmed platform actor", async () => {
    expect(result(user, null, true)).toEqual({ kind: "granted" });
    await expect(loadPlatformActor(client(true))).resolves.toEqual({ kind: "granted" });
  });

  it("denies unauthenticated and ordinary authenticated users", () => {
    expect(result(null, null)).toEqual({ kind: "denied", reason: "unauthenticated" });
    expect(result(user, null, false)).toEqual({ kind: "denied", reason: "not_platform" });
  });

  it("fails closed when auth or the server grant is unavailable or malformed", async () => {
    expect(result(user, { message: "auth unavailable" })).toEqual({ kind: "unavailable" });
    expect(result(user, null, undefined)).toEqual({ kind: "unavailable" });
    expect(result(user, null, "true")).toEqual({ kind: "unavailable" });
    await expect(loadPlatformActor(client(true, { message: "rpc unavailable" }))).resolves.toEqual({ kind: "unavailable" });
  });
});
