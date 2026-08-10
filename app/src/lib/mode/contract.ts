import { safeNextPath } from "@/lib/auth/oauth";
import { isCanonicalWorkspaceSlug } from "@/lib/auth/workspace-routing";

export const MODE_PREFERENCE_COOKIE = "mw_mode" as const;

export type PresentationMode = "platform" | "user";
export type PlatformAccess = "granted" | "denied" | "unavailable";
export type VerifiedModeMembership = { orgId: string; slug: string };

export type ModeDestination =
  | { kind: "chooser"; path: "/mode" }
  | { kind: "platform"; path: "/platform" }
  | { kind: "workspace"; path: `/w/${string}` }
  | { kind: "workspaces"; path: "/workspaces" }
  | { kind: "entry"; path: "/workspace-entry" }
  | { kind: "fail-closed"; path: "/workspace-entry?error=routing" };

export function parsePresentationMode(value: unknown): PresentationMode | null {
  return value === "platform" || value === "user" ? value : null;
}

/** Direct preference mutation is a platform-only convenience action. */
export function decideModeMutation(
  platformAccess: PlatformAccess,
  rawMode: unknown,
):
  | { kind: "accepted"; mode: PresentationMode }
  | { kind: "forbidden" }
  | { kind: "unavailable" }
  | { kind: "invalid" } {
  if (platformAccess === "unavailable") return { kind: "unavailable" };
  if (platformAccess !== "granted") return { kind: "forbidden" };
  const mode = parsePresentationMode(rawMode);
  return mode ? { kind: "accepted", mode } : { kind: "invalid" };
}

/**
 * `next` is a return hint only. It is never an authority input or a direct
 * destination for a chosen mode; workspace routing remains membership-verified.
 */
export function sanitizeModeNext(value: unknown): string | null {
  const next = safeNextPath(value, "");
  return next || null;
}

function validMemberships(
  memberships: readonly VerifiedModeMembership[],
): boolean {
  const orgIds = new Set<string>();
  const slugs = new Set<string>();
  for (const membership of memberships) {
    if (
      !membership.orgId.trim() ||
      !isCanonicalWorkspaceSlug(membership.slug) ||
      orgIds.has(membership.orgId) ||
      slugs.has(membership.slug)
    ) {
      return false;
    }
    orgIds.add(membership.orgId);
    slugs.add(membership.slug);
  }
  return true;
}

/**
 * User mode delegates only to verified active memberships. A mode preference
 * cannot manufacture a tenant, select an arbitrary slug, or bypass the
 * existing one-membership zero-click behaviour.
 */
export function decideUserModeDestination(
  memberships: readonly VerifiedModeMembership[],
): Exclude<ModeDestination, { kind: "chooser" } | { kind: "platform" }> {
  if (!validMemberships(memberships)) {
    return { kind: "fail-closed", path: "/workspace-entry?error=routing" };
  }
  if (memberships.length === 0) return { kind: "entry", path: "/workspace-entry" };
  if (memberships.length > 1) return { kind: "workspaces", path: "/workspaces" };
  return { kind: "workspace", path: `/w/${memberships[0].slug}` };
}

/**
 * Narrow consumer API for T04: pass a verified active-membership snapshot and
 * canonical platform guard result. The preference remains presentation-only.
 */
export function decideModeDestination({
  preference,
  platformAccess,
  memberships,
}: {
  preference: PresentationMode | null;
  platformAccess: PlatformAccess;
  memberships: readonly VerifiedModeMembership[];
}): ModeDestination {
  if (preference === "platform" && platformAccess === "granted") {
    return { kind: "platform", path: "/platform" };
  }
  if (preference === null && platformAccess === "granted") {
    return { kind: "chooser", path: "/mode" };
  }
  return decideUserModeDestination(memberships);
}
