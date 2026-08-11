import type { Ctx } from "@/lib/types";
import type { WorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import {
  decideAccessFailureDestination,
  type AccessFailureDestination,
} from "./access-failure";

type ReadyWorkspaceRoutingSnapshot = Extract<
  WorkspaceRoutingSnapshot,
  { kind: "ready" }
>;

export type AppLayoutAccess =
  | {
      kind: "allowed";
      ctx: Ctx;
      routing: ReadyWorkspaceRoutingSnapshot;
    }
  | AccessFailureDestination;

/**
 * The routing snapshot owns authentication/membership classification. The
 * session loader remains an authority reader only and never guesses why a
 * context is absent.
 */
export function decideAppLayoutAccess(
  routing: WorkspaceRoutingSnapshot,
  ctx: Ctx | null,
): AppLayoutAccess {
  if (routing.kind === "unauthenticated") {
    return decideAccessFailureDestination({
      kind: "unauthenticated",
      nextPath: "/workspace-entry",
      source: "tenant-session",
    });
  }
  if (routing.kind === "error") {
    return decideAccessFailureDestination({
      kind: "authenticated-denial",
      reason: "membership-unavailable",
      source: "tenant-session",
    });
  }
  if (routing.memberships.length === 0) {
    return decideAccessFailureDestination({
      kind: "authenticated-denial",
      reason: "non-member",
      source: "tenant-session",
    });
  }
  if (!ctx) {
    return decideAccessFailureDestination({
      kind: "authenticated-denial",
      reason: "membership-inconsistent",
      source: "tenant-session",
    });
  }
  return { kind: "allowed", ctx, routing };
}
