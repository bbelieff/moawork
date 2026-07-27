import {
  type ServerWorkspaceMembership,
  type WorkspaceSwitcherModel,
  type WorkspaceSwitcherServerLoader,
  type WorkspaceSwitcherServerSnapshot,
  type WorkspaceSwitcherWorkspace,
  WORKSPACE_SWITCHER_DESTINATIONS,
} from "./contracts";

const canonicalSlug = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function validMembership(value: ServerWorkspaceMembership): boolean {
  return Boolean(
    value.membershipStatus === "active" &&
      value.tenantScope === "current" &&
    value.orgId.trim() &&
      value.name.trim() &&
      canonicalSlug.test(value.slug) &&
      Number.isFinite(Date.parse(value.createdAt)),
  );
}

function compareMemberships(left: ServerWorkspaceMembership, right: ServerWorkspaceMembership): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.orgId.localeCompare(right.orgId)
    || left.slug.localeCompare(right.slug);
}

/**
 * Turns an already-authenticated, tenant-scoped server snapshot into a UI-safe
 * model. It performs no lookup and cannot enumerate organisations beyond the
 * active memberships supplied by the server loader.
 */
export function buildWorkspaceSwitcherModel(
  snapshot: WorkspaceSwitcherServerSnapshot,
): WorkspaceSwitcherModel {
  const seenOrgIds = new Set<string>();
  const memberships = snapshot.memberships
    .filter(validMembership)
    .filter((membership) => {
      if (seenOrgIds.has(membership.orgId)) return false;
      seenOrgIds.add(membership.orgId);
      return true;
    })
    .sort(compareMemberships);

  const currentOrgId = memberships.some((membership) => membership.orgId === snapshot.currentOrgId)
    ? snapshot.currentOrgId
    : null;
  const workspaces: WorkspaceSwitcherWorkspace[] = memberships.map((membership) => ({
    kind: "workspace",
    orgId: membership.orgId,
    slug: membership.slug,
    name: membership.name,
    role: membership.role,
    href: `/w/${membership.slug}`,
    signedIconUrl: membership.signedIconUrl,
    isCurrent: membership.orgId === currentOrgId,
    disabled: false,
  }));

  const pendingIds = new Set<string>();
  const pendingEntries = snapshot.ownPendingEntryRequests
    .filter((request) => request.status === "pending" && request.requestId.trim() && Number.isFinite(Date.parse(request.createdAt)))
    .filter((request) => {
      if (pendingIds.has(request.requestId)) return false;
      pendingIds.add(request.requestId);
      return true;
    })
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.requestId.localeCompare(right.requestId))
    .map((request) => ({
      kind: "pending_entry" as const,
      requestId: request.requestId,
      entryKind: request.kind,
      createdAt: request.createdAt,
      disabled: true as const,
    }));

  return {
    workspaces,
    pendingEntries,
    canUsePlatformControls: snapshot.platformAccess === "granted",
    ...WORKSPACE_SWITCHER_DESTINATIONS,
  };
}

/** Server integration seam: authentication, membership scope, and platform access stay in the adapter. */
export async function loadWorkspaceSwitcherModel(
  loader: WorkspaceSwitcherServerLoader,
): Promise<WorkspaceSwitcherModel> {
  return buildWorkspaceSwitcherModel(await loader.readForAuthenticatedSession());
}
