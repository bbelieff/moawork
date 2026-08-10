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

export function platformAccessFailurePath(access: PlatformAccess): string | null {
  if (access.kind === "allowed" || access.reason === "unauthenticated") return null;
  return access.reason === "unavailable"
    ? "/?error=platform-unavailable"
    : "/?error=platform-forbidden";
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
  const failurePath = platformAccessFailurePath(access);
  if (failurePath) {
    console.warn("[platform-access] denied", { reason: access.kind === "denied" ? access.reason : "unknown" });
    redirect(failurePath);
  }
}
