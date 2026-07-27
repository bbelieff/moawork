import { describe, expect, it } from "vitest";
import type { WorkspaceSwitcherServerSnapshot } from "./contracts";
import { buildWorkspaceSwitcherModel } from "./server";

function snapshot(overrides: Partial<WorkspaceSwitcherServerSnapshot> = {}): WorkspaceSwitcherServerSnapshot {
  return {
    currentOrgId: "org-current",
    platformAccess: "unknown",
    memberships: [
      { orgId: "org-later", slug: "later-team", name: "Later", role: "member", createdAt: "2026-07-02T00:00:00.000Z", membershipStatus: "active", tenantScope: "current", signedIconUrl: null },
      { orgId: "org-current", slug: "current-team", name: "Current", role: "owner", createdAt: "2026-07-01T00:00:00.000Z", membershipStatus: "active", tenantScope: "current", signedIconUrl: "https://signed.invalid/icon" },
      { orgId: "org-current", slug: "duplicate", name: "Duplicate", role: "owner", createdAt: "2026-07-03T00:00:00.000Z", membershipStatus: "active", tenantScope: "current", signedIconUrl: null },
      { orgId: "org-inactive", slug: "inactive-team", name: "Excluded", role: "member", createdAt: "2026-07-01T00:00:00.000Z", membershipStatus: "inactive", tenantScope: "current", signedIconUrl: null },
      { orgId: "org-foreign", slug: "foreign-team", name: "Excluded", role: "member", createdAt: "2026-07-01T00:00:00.000Z", membershipStatus: "active", tenantScope: "foreign", signedIconUrl: null },
    ],
    ownPendingEntryRequests: [
      { requestId: "join-1", kind: "join", status: "pending", createdAt: "2026-07-03T00:00:00.000Z" },
      { requestId: "join-1", kind: "join", status: "pending", createdAt: "2026-07-04T00:00:00.000Z" },
    ],
    ...overrides,
  };
}

describe("buildWorkspaceSwitcherModel", () => {
  it("keeps active memberships in stable deduplicated order and marks the current membership once", () => {
    const result = buildWorkspaceSwitcherModel(snapshot());
    expect(result.workspaces.map((item) => item.orgId)).toEqual(["org-current", "org-later"]);
    expect(result.workspaces.filter((item) => item.isCurrent)).toHaveLength(1);
    expect(result.workspaces[0]).toMatchObject({ href: "/w/current-team", signedIconUrl: "https://signed.invalid/icon", disabled: false });
  });

  it("fails closed for an untrusted platform state and makes pending requests disabled non-entry records", () => {
    const result = buildWorkspaceSwitcherModel(snapshot());
    expect(result.canUsePlatformControls).toBe(false);
    expect(result.pendingEntries).toEqual([
      { kind: "pending_entry", requestId: "join-1", entryKind: "join", createdAt: "2026-07-03T00:00:00.000Z", disabled: true },
    ]);
    expect(JSON.stringify(result.pendingEntries)).not.toContain("slug");
    expect(JSON.stringify(result.pendingEntries)).not.toContain("orgId");
  });

  it("does not turn an absent or inactive current organisation into a selected workspace", () => {
    const result = buildWorkspaceSwitcherModel(snapshot({ currentOrgId: "inactive-org" }));
    expect(result.workspaces.filter((item) => item.isCurrent)).toHaveLength(0);
  });

  it("uses only canonical destinations with no stale target intent", () => {
    const result = buildWorkspaceSwitcherModel(snapshot({ platformAccess: "granted" }));
    expect(result.canUsePlatformControls).toBe(true);
    expect(result.createWorkspaceHref).toBe("/workspace-entry?mode=new");
    expect(result.joinWorkspaceHref).toBe("/workspace-entry?mode=resume");
  });
});
