import { describe, expect, it } from "vitest";
import {
  chooseSessionMembership,
  decideWorkspaceDestination,
  isCanonicalWorkspaceSlug,
  parseActiveMembershipRows,
  workspaceTargetFromNext,
} from "./workspace-routing";

function row(
  orgId: string,
  slug: string | null,
  membershipStatus = "active",
  workspaceStatus = "active",
) {
  return {
    org_id: orgId,
    status: membershipStatus,
    role: "member",
    scope: "assigned",
    orgs: {
      id: orgId,
      slug,
      status: workspaceStatus,
      name: "테스트 회사",
      plan_tier: "t1_3",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("workspace routing", () => {
  it("active membership 0/1/2+를 entry/direct/chooser로 결정한다", () => {
    expect(decideWorkspaceDestination([])).toEqual({
      kind: "entry",
      path: "/workspace-entry",
    });
    expect(decideWorkspaceDestination([row("org-1", "alpha-team")])).toEqual(
      {
        kind: "workspace",
        path: "/w/alpha-team",
        orgId: "org-1",
        slug: "alpha-team",
      },
    );
    expect(
      decideWorkspaceDestination([
        row("org-1", "alpha-team"),
        row("org-2", "beta-team"),
      ]),
    ).toEqual({ kind: "chooser", path: "/workspaces" });
  });

  it("inactive membership와 Workspace를 active count에서 제외한다", () => {
    expect(
      decideWorkspaceDestination([
        row("org-1", "alpha-team", "removed"),
        row("org-2", "beta-team", "active", "suspended"),
      ]),
    ).toEqual({ kind: "entry", path: "/workspace-entry" });
  });

  it("unknown status, missing slug, duplicate org/slug는 fail-closed다", () => {
    for (const rows of [
      [row("org-1", "alpha-team", "mystery")],
      [row("org-1", null)],
      [row("org-1", "alpha-team"), row("org-1", "beta-team")],
      [row("org-1", "alpha-team"), row("org-2", "alpha-team")],
    ]) {
      expect(decideWorkspaceDestination(rows)).toEqual({
        kind: "fail-closed",
        path: "/workspace-entry?error=routing",
      });
    }
  });

  it("accepted target는 active membership 재검증 뒤에만 0-click 대상이 된다", () => {
    const rows = [
      row("org-1", "alpha-team"),
      row("org-2", "beta-team"),
    ];
    expect(
      decideWorkspaceDestination(rows, {
        kind: "workspace",
        slug: "beta-team",
        path: "/w/beta-team",
      }),
    ).toEqual({
      kind: "workspace",
      path: "/w/beta-team",
      orgId: "org-2",
      slug: "beta-team",
    });
    expect(
      decideWorkspaceDestination(rows, {
        kind: "workspace",
        slug: "other-team",
        path: "/w/other-team",
      }),
    ).toEqual({
      kind: "fail-closed",
      path: "/workspace-entry?error=routing",
    });
  });

  it("next/query는 정확한 canonical Workspace path만 후보로 파싱한다", () => {
    expect(workspaceTargetFromNext("/w/alpha-team/boards/42?tab=files")).toEqual({
      kind: "workspace",
      slug: "alpha-team",
      path: "/w/alpha-team/boards/42?tab=files",
    });
    expect(workspaceTargetFromNext("/settings/account")).toEqual({
      kind: "none",
    });
    expect(workspaceTargetFromNext("https://evil.example/w/alpha-team")).toEqual({ kind: "invalid" });
    expect(workspaceTargetFromNext("//evil.example/w/alpha-team")).toEqual({ kind: "invalid" });
    expect(workspaceTargetFromNext("/w/../../admin")).toEqual({
      kind: "invalid",
    });
    expect(workspaceTargetFromNext("/w/UPPER_CASE")).toEqual({
      kind: "invalid",
    });
  });

  it("org cookie는 exact active membership 선택에만 쓰고 fallback하지 않는다", () => {
    const rows = [
      row("org-1", "alpha-team"),
      row("org-2", "beta-team"),
    ];
    expect(chooseSessionMembership(rows, "org-2")?.slug).toBe("beta-team");
    expect(chooseSessionMembership(rows, "cross-tenant")).toBeNull();
    expect(chooseSessionMembership(rows)).toBeNull();
    expect(chooseSessionMembership([rows[0]])?.slug).toBe("alpha-team");
  });

  it("canonical slug grammar를 강제한다", () => {
    expect(isCanonicalWorkspaceSlug("abc")).toBe(true);
    expect(isCanonicalWorkspaceSlug("alpha-123")).toBe(true);
    for (const value of ["ab", "Alpha", "alpha_1", "-alpha", "alpha-"]) {
      expect(isCanonicalWorkspaceSlug(value)).toBe(false);
    }
  });

  it("비배열·잘못된 relation payload도 낙관하지 않는다", () => {
    expect(parseActiveMembershipRows(null).ok).toBe(false);
    expect(
      parseActiveMembershipRows([
        { org_id: "org-1", status: "active", orgs: null },
      ]).ok,
    ).toBe(false);
  });
});
