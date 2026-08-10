/**
 * Server-only handoff contract for the workspace switcher.  Callers may pass
 * a snapshot produced by an authenticated server loader only; this module
 * deliberately accepts neither a user id nor a requested organisation id.
 */
export type WorkspaceRole = "owner" | "admin" | "member";

export type ServerWorkspaceMembership = Readonly<{
  orgId: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
  /** Evidence from the authenticated server query; anything else is excluded. */
  membershipStatus: "active" | "inactive" | "pending";
  tenantScope: "current" | "foreign";
  /** A server-created signed URL, if one is available. */
  signedIconUrl: string | null;
}>;

export type OwnPendingWorkspaceEntry = Readonly<{
  requestId: string;
  kind: "create" | "join";
  status: "pending";
  createdAt: string;
}>;

export type ServerDerivedPlatformAccess = "granted" | "denied" | "unknown";

export type WorkspaceSwitcherServerSnapshot = Readonly<{
  /** The active membership chosen by the authenticated server session, if any. */
  currentOrgId: string | null;
  memberships: readonly ServerWorkspaceMembership[];
  /** Own requests only. Pending items intentionally contain no target identity. */
  ownPendingEntryRequests: readonly OwnPendingWorkspaceEntry[];
  /** Derived by the server; unknown is denied at the presentation boundary. */
  platformAccess: ServerDerivedPlatformAccess;
}>;

export type WorkspaceSwitcherWorkspace = Readonly<{
  kind: "workspace";
  orgId: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  href: `/w/${string}`;
  signedIconUrl: string | null;
  isCurrent: boolean;
  disabled: false;
}>;

export type WorkspaceSwitcherPending = Readonly<{
  kind: "pending_entry";
  requestId: string;
  entryKind: "create" | "join";
  createdAt: string;
  disabled: true;
}>;

export type WorkspaceSwitcherModel = Readonly<{
  workspaces: readonly WorkspaceSwitcherWorkspace[];
  pendingEntries: readonly WorkspaceSwitcherPending[];
  canUsePlatformControls: boolean;
  createWorkspaceHref: "/workspace-entry?mode=new";
  joinWorkspaceHref: "/workspace-entry?mode=resume";
}>;

/** The adapter owns authentication and tenant filtering; callers never provide authority inputs. */
export type WorkspaceSwitcherServerLoader = Readonly<{
  readForAuthenticatedSession(): Promise<WorkspaceSwitcherServerSnapshot>;
}>;

/** Canonical entry destinations carry only the B3 mode; never a stale target or request id. */
export const WORKSPACE_SWITCHER_DESTINATIONS = {
  createWorkspaceHref: "/workspace-entry?mode=new",
  joinWorkspaceHref: "/workspace-entry?mode=resume",
} as const;
