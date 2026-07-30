import { redirect } from "next/navigation";
import { loadWorkspaceRoutingSnapshot, type WorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { loadWorkspaceEntryContext, type WorkspaceEntryContext } from "@/lib/workspace-entry/server";

export type PlatformAccess = { kind: "allowed" } | { kind: "denied"; reason: "routing" | "permission" };

/** Pure boundary used by focused tests and the server guard below. */
export function resolvePlatformAccess(
  routing: WorkspaceRoutingSnapshot,
  context: WorkspaceEntryContext,
): PlatformAccess {
  if (routing.kind !== "ready") return { kind: "denied", reason: "routing" };
  if (context.kind !== "ready" || !context.isPlatformAdmin) {
    return { kind: "denied", reason: "permission" };
  }
  return { kind: "allowed" };
}

/**
 * Platform is server-gated via the existing authenticated routing loader and
 * its platform-admin RPC. A failed check fails closed; pages never infer a
 * platform role from client state.
 */
export async function requirePlatformAccess(nextPath: string): Promise<void> {
  const routing = await loadWorkspaceRoutingSnapshot();
  if (routing.kind === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const context = await loadWorkspaceEntryContext();
  const access = resolvePlatformAccess(routing, context);
  if (access.kind !== "allowed") {
    redirect("/workspace-entry?error=permission");
  }
}
