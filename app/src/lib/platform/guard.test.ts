import { describe, expect, it } from "vitest";
import { resolvePlatformAccess } from "./guard";

const routing = { kind: "ready" as const, memberships: [], selfRouteState: "eligible_entry" as const };
const ready = {
  kind: "ready" as const,
  isPlatformAdmin: true,
  requests: [],
  platformCreateRequests: [],
  ownerJoinRequests: [],
  ownerPendingApprovalCount: 0,
};

describe("resolvePlatformAccess", () => {
  it("allows only a server-confirmed platform administrator", () => {
    expect(resolvePlatformAccess(routing, ready)).toEqual({ kind: "allowed" });
    expect(resolvePlatformAccess(routing, { ...ready, isPlatformAdmin: false })).toEqual({ kind: "denied", reason: "permission" });
  });

  it("fails closed when authentication routing or the RPC context is unavailable", () => {
    expect(resolvePlatformAccess({ kind: "unauthenticated" }, ready)).toEqual({ kind: "denied", reason: "routing" });
    expect(resolvePlatformAccess({ kind: "error" }, ready)).toEqual({ kind: "denied", reason: "routing" });
    expect(resolvePlatformAccess(routing, { kind: "error" })).toEqual({ kind: "denied", reason: "permission" });
  });
});
