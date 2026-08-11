import { describe, expect, it } from "vitest";
import {
  AUTHENTICATED_ACCESS_FAILURE_PATH,
  decideAccessFailureDestination,
  type AccessFailureSource,
  type AuthenticatedAccessFailureReason,
} from "./access-failure";

describe("access failure routing", () => {
  it("preserves the requested internal path only while authentication is required", () => {
    expect(
      decideAccessFailureDestination({
        kind: "unauthenticated",
        nextPath: "/platform/workspace-requests?tab=pending",
        source: "platform-guard",
      }),
    ).toEqual({
      kind: "authenticate",
      path: "/login?next=%2Fplatform%2Fworkspace-requests%3Ftab%3Dpending",
    });
  });

  it.each(["https://attacker.invalid", "//attacker.invalid", "/%2f/escape"])(
    "fails unsafe login return path %s back to workspace entry",
    (nextPath) => {
      expect(
        decideAccessFailureDestination({
          kind: "unauthenticated",
          nextPath,
          source: "tenant-session",
        }),
      ).toEqual({
        kind: "authenticate",
        path: "/login?next=%2Fworkspace-entry",
      });
    },
  );

  it.each(["/login", "/login?next=%2Fplatform", "/auth", "/auth/callback"])(
    "avoids an authentication redirect loop for %s",
    (nextPath) => {
      expect(
        decideAccessFailureDestination({
          kind: "unauthenticated",
          nextPath,
          source: "platform-guard",
        }),
      ).toEqual({
        kind: "authenticate",
        path: "/login?next=%2Fworkspace-entry",
      });
    },
  );

  it("converges all three measured boundaries and all authenticated denial reasons", () => {
    const sources: AccessFailureSource[] = [
      "tenant-session",
      "platform-guard",
      "workspace-route",
    ];
    const reasons: AuthenticatedAccessFailureReason[] = [
      "permission",
      "non-member",
      "membership-unavailable",
      "membership-inconsistent",
    ];

    for (const source of sources) {
      for (const reason of reasons) {
        expect(
          decideAccessFailureDestination({
            kind: "authenticated-denial",
            reason,
            source,
          }),
        ).toEqual({
          kind: "fail-closed",
          path: AUTHENTICATED_ACCESS_FAILURE_PATH,
        });
      }
    }
  });

  it("keeps the public denial destination generic and tenant-neutral", () => {
    expect(AUTHENTICATED_ACCESS_FAILURE_PATH).toBe(
      "/workspace-entry?error=routing",
    );
    expect(AUTHENTICATED_ACCESS_FAILURE_PATH).not.toMatch(/org|workspaceId|slug/);
  });
});
