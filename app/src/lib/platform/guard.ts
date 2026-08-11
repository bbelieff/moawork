import { redirect } from "next/navigation";
import {
  decideAccessFailureDestination,
  type AccessFailureDestination,
} from "@/lib/auth/routing/access-failure";
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

export function decidePlatformAccessDestination(
  access: PlatformAccess,
  nextPath: string,
): AccessFailureDestination | null {
  if (access.kind === "allowed") return null;
  if (access.reason === "unauthenticated") {
    return decideAccessFailureDestination({
      kind: "unauthenticated",
      nextPath,
      source: "platform-guard",
    });
  }
  return decideAccessFailureDestination({
    kind: "authenticated-denial",
    reason: access.reason === "unavailable"
      ? "membership-unavailable"
      : "permission",
    source: "platform-guard",
  });
}

/**
 * A failed platform-plane actor check fails closed. This boundary deliberately
 * does not depend on workspace-entry routing or selected workspace context.
 */
export async function requirePlatformAccess(nextPath: string): Promise<void> {
  const access = resolvePlatformAccess(await loadPlatformActor());
  const destination = decidePlatformAccessDestination(access, nextPath);
  if (destination) {
    console.warn("[platform-access] denied", { reason: access.kind === "denied" ? access.reason : "unknown" });
    redirect(destination.path);
  }
}
