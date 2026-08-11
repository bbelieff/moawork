import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import { decideAppLayoutAccess } from "@/lib/auth/routing/app-layout";

const ctx = {
  user: { id: "user-1" },
  org: { id: "org-1" },
  role: "member",
  scope: "assigned",
  isPlatformAdmin: false,
} as Ctx;

describe("app layout access routing", () => {
  it("keeps unauthenticated access distinct and points to a safe login return", () => {
    expect(decideAppLayoutAccess({ kind: "unauthenticated" }, null)).toEqual({
      kind: "authenticate",
      path: "/login?next=%2Fworkspace-entry",
    });
  });

  it("routes unavailable, nonmember, and inconsistent membership states neutrally", () => {
    expect(decideAppLayoutAccess({ kind: "error" }, null)).toEqual({
      kind: "fail-closed",
      path: "/workspace-entry?error=routing",
    });
    expect(decideAppLayoutAccess({
      kind: "ready",
      memberships: [],
      selfRouteState: "eligible_entry",
    }, null)).toEqual({
      kind: "fail-closed",
      path: "/workspace-entry?error=routing",
    });
    expect(decideAppLayoutAccess({
      kind: "ready",
      memberships: [{
        orgId: "org-1",
        slug: "alpha-team",
        name: "알파 팀",
        role: "member",
      }],
      selfRouteState: "eligible_entry",
    }, null)).toEqual({
      kind: "fail-closed",
      path: "/workspace-entry?error=routing",
    });
  });

  it("keeps a verified tenant session allowed without changing its authority", () => {
    const routing = {
      kind: "ready" as const,
      memberships: [{
        orgId: "org-1",
        slug: "alpha-team",
        name: "알파 팀",
        role: "member" as const,
      }],
      selfRouteState: "eligible_entry" as const,
    };
    expect(decideAppLayoutAccess(routing, ctx)).toEqual({
      kind: "allowed",
      ctx,
      routing,
    });
  });
});
