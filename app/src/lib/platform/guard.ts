import { redirect } from "next/navigation";
import { loadPlatformActor, type PlatformActor } from "./actor";

export type PlatformAccess = { kind: "allowed" } | { kind: "denied"; reason: "unauthenticated" | "permission" | "unavailable" };

/** Pure boundary used by focused tests and the server guard below. */
export function resolvePlatformAccess(actor: PlatformActor): PlatformAccess {
  if (actor.kind === "granted") return { kind: "allowed" };
  if (actor.kind === "denied" && actor.reason === "unauthenticated") {
    return { kind: "denied", reason: "unauthenticated" };
  }
  return { kind: "denied", reason: actor.kind === "unavailable" ? "unavailable" : "permission" };
}

/**
 * A failed platform-plane actor check fails closed. This boundary deliberately
 * does not depend on workspace-entry routing or selected workspace context.
 */
export async function requirePlatformAccess(nextPath: string): Promise<void> {
  const access = resolvePlatformAccess(await loadPlatformActor());
  if (access.kind === "denied" && access.reason === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (access.kind !== "allowed") {
    redirect("/?error=platform");
  }
}
