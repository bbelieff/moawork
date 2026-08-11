import { safeNextPath } from "../oauth";

export const AUTHENTICATED_ACCESS_FAILURE_PATH =
  "/workspace-entry?error=routing" as const;

export type AccessFailureSource =
  | "tenant-session"
  | "platform-guard"
  | "workspace-route";

export type AuthenticatedAccessFailureReason =
  | "permission"
  | "non-member"
  | "membership-unavailable"
  | "membership-inconsistent";

export type AccessFailure =
  | {
      kind: "unauthenticated";
      nextPath: string;
      source: AccessFailureSource;
    }
  | {
      kind: "authenticated-denial";
      reason: AuthenticatedAccessFailureReason;
      source: AccessFailureSource;
    };

export type AccessFailureDestination =
  | { kind: "authenticate"; path: `/login?next=${string}` }
  | {
      kind: "fail-closed";
      path: typeof AUTHENTICATED_ACCESS_FAILURE_PATH;
    };

function safeAuthenticationNextPath(value: string): string {
  const safe = safeNextPath(value, "/workspace-entry");
  const pathname = safe.split(/[?#]/, 1)[0];
  return pathname === "/login" || pathname === "/auth" || pathname.startsWith("/auth/")
    ? "/workspace-entry"
    : safe;
}

/**
 * Authentication and authorization are separate boundaries. Visitors without
 * a session authenticate first. Every authenticated denial converges on the
 * same tenant-neutral screen, without exposing the reason or workspace data in
 * the URL.
 */
export function decideAccessFailureDestination(
  failure: AccessFailure,
): AccessFailureDestination {
  if (failure.kind === "unauthenticated") {
    const nextPath = safeAuthenticationNextPath(failure.nextPath);
    return {
      kind: "authenticate",
      path: `/login?next=${encodeURIComponent(nextPath)}`,
    };
  }

  return {
    kind: "fail-closed",
    path: AUTHENTICATED_ACCESS_FAILURE_PATH,
  };
}
