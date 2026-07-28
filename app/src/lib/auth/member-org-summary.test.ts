import { describe, expect, it } from "vitest";
import { applyMemberProfiles, buildMemberOrgSummary } from "./member-org-summary";

describe("buildMemberOrgSummary", () => {
  const owner = { org_id: "org-a", user_id: "owner-a", role: "owner", scope: "all", created_at: "2026-01-01T00:00:00Z", users: { name: "대표" } };

  it("puts the one protected owner first and groups other active memberships without ranking", () => {
    const summary = buildMemberOrgSummary("org-a", [
      owner,
      { org_id: "org-a", user_id: "member-a", role: "member", scope: "assigned", created_at: "2026-01-03T00:00:00Z", users: { name: "사원" } },
      { org_id: "org-a", user_id: "admin-a", role: "admin", scope: "all", created_at: "2026-01-02T00:00:00Z", users: { name: "팀장" } },
      { org_id: "org-b", user_id: "foreign", role: "owner", scope: "all", created_at: "2026-01-01T00:00:00Z", users: { name: "다른 회사" } },
    ]);
    expect(summary).toMatchObject({ kind: "ready", owner: { userId: "owner-a" } });
    if (summary.kind !== "ready") throw new Error("expected ready");
    expect(summary.admins.map((member) => member.userId)).toEqual(["admin-a"]);
    expect(summary.members.map((member) => member.userId)).toEqual(["member-a"]);
  });

  it("fails closed when the protected owner is absent, duplicated, or not all-scope", () => {
    expect(buildMemberOrgSummary("org-a", [])).toEqual({ kind: "owner_integrity_error" });
    expect(buildMemberOrgSummary("org-a", [owner, { ...owner, user_id: "owner-b" }])).toEqual({ kind: "owner_integrity_error" });
    expect(buildMemberOrgSummary("org-a", [{ ...owner, scope: "assigned" }])).toEqual({ kind: "owner_integrity_error" });
  });

  it("uses the 011 profile RPC shape for display fields and fails closed on a mismatched profile", () => {
    const summary = buildMemberOrgSummary("org-a", [owner]);
    const hydrated = applyMemberProfiles(summary, new Map([
      ["owner-a", { id: "owner-a", name: "대표", title: "대표", team_key: "leadership" }],
    ]));
    expect(hydrated).toMatchObject({ kind: "ready", owner: { title: "대표", teamKey: "leadership" } });
    expect(applyMemberProfiles(summary, new Map([["owner-a", { id: "other", name: "대표" }]]))).toEqual({ kind: "error" });
  });
});
