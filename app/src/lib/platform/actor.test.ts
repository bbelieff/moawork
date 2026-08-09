import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  beforeEach(() => warn.mockClear());
  afterAll(() => warn.mockRestore());

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
    expect(warn).toHaveBeenLastCalledWith("[platform-actor] unavailable", { reason: "grant_error" });
  });

  it("logs only a safe classification for malformed and unexpected failures", async () => {
    await expect(loadPlatformActor(client("true"))).resolves.toEqual({ kind: "unavailable" });
    expect(warn).toHaveBeenLastCalledWith("[platform-actor] unavailable", { reason: "grant_malformed" });

    const throwing: PlatformActorClient = {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      rpc: async () => { throw new Error("private provider detail"); },
    };
    await expect(loadPlatformActor(throwing)).resolves.toEqual({ kind: "unavailable" });
    expect(warn).toHaveBeenLastCalledWith("[platform-actor] unavailable", { reason: "unexpected_error" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private provider detail");
  });
});
