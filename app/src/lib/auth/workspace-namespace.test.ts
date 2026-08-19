import { describe, expect, it } from "vitest";
import { decideWorkspaceNamespace } from "./workspace-namespace";

function row(orgId: string, slug: string, status = "active") {
  return { org_id: orgId, status, role: "member", scope: "assigned", orgs: { id: orgId, slug, status: "active", name: "샘플 회사", plan_tier: "t1_3", created_at: "2026-01-01T00:00:00Z" } };
}

describe("workspace namespace", () => {
  it("rewrites bare and deep canonical paths while preserving query", () => {
    expect(decideWorkspaceNamespace("/w/alpha-team", [row("org-1", "alpha-team")])).toEqual({ kind: "rewrite", canonical: "/w/alpha-team", internal: "/", orgId: "org-1" });
    expect(decideWorkspaceNamespace("/w/alpha-team/settings/account?tab=privacy", [row("org-1", "alpha-team")])).toEqual({ kind: "rewrite", canonical: "/w/alpha-team/settings/account?tab=privacy", internal: "/settings/account?tab=privacy", orgId: "org-1" });
    expect(decideWorkspaceNamespace("/w/acme/deals/123?tab=notes", [row("org-acme", "acme")])).toEqual({ kind: "rewrite", canonical: "/w/acme/deals/123?tab=notes", internal: "/deals/123?tab=notes", orgId: "org-acme" });
    expect(decideWorkspaceNamespace("/w/acme/companies", [row("org-acme", "acme")])).toEqual({ kind: "rewrite", canonical: "/w/acme/companies", internal: "/companies", orgId: "org-acme" });
    expect(decideWorkspaceNamespace("/w/acme/presets", [row("org-acme", "acme")])).toEqual({ kind: "rewrite", canonical: "/w/acme/presets", internal: "/presets", orgId: "org-acme" });
  });

  it("lets an exact target win among multiple memberships", () => {
    expect(decideWorkspaceNamespace("/w/beta-team/boards", [row("org-1", "alpha-team"), row("org-2", "beta-team")])).toMatchObject({ kind: "rewrite", orgId: "org-2" });
  });

  it("validates aliases against active membership and never aliases static routes", () => {
    expect(decideWorkspaceNamespace("/alpha-team?tab=work", [row("org-1", "alpha-team")])).toEqual({ kind: "alias", canonical: "/w/alpha-team?tab=work", orgId: "org-1" });
    expect(decideWorkspaceNamespace("/settings", [row("org-1", "settings")])).toEqual({ kind: "none" });
    expect(decideWorkspaceNamespace("/settlements", [row("org-1", "settlements")])).toEqual({ kind: "none" });
  });

  it("converges unknown, nonmember, revoked, and encoded escape probes", () => {
    for (const [path, rows] of [
      ["/w/unknown", [row("org-1", "alpha-team")]],
      ["/unknown", [row("org-1", "alpha-team")]],
      ["/w/alpha-team", [row("org-1", "alpha-team", "removed")]],
      ["/w/alpha-team/%252e%252e/admin", [row("org-1", "alpha-team")]],
      ["/w/alpha-team/%25252e%25252e/admin", [row("org-1", "alpha-team")]],
      ["/w/alpha-team/%25252fapi", [row("org-1", "alpha-team")]],
      ["/w/alpha-team/api/workspace-requests", [row("org-1", "alpha-team")]],
      ["/w/alpha-team/auth/signout", [row("org-1", "alpha-team")]],
    ] as const) expect(decideWorkspaceNamespace(path, rows)).toEqual({ kind: "deny" });
  });
});
