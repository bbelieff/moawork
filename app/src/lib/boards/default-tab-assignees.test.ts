import { describe, expect, it } from "vitest";
import type { MemberOrgSummary } from "@/lib/auth/member-org-summary";
import { assigneesFromMemberSummary } from "./default-tab-assignees";

describe("assigneesFromMemberSummary", () => {
  it("org_members 정본 순서로 owner·admin·member 계정을 공급한다", () => {
    const row = (userId: string, displayName: string, role: "owner" | "admin" | "member") => ({
      orgId: "org-1",
      userId,
      displayName,
      role,
      scope: "all" as const,
      title: null,
      teamKey: null,
      createdAt: `2026-08-14T00:00:0${userId.at(-1)}Z`,
    });
    const summary: MemberOrgSummary = {
      kind: "ready",
      owner: row("member-1", "대표", "owner"),
      admins: [row("member-2", "실장", "admin")],
      members: [row("member-3", "담당자", "member")],
    };
    expect(assigneesFromMemberSummary(summary)).toEqual([
      { userId: "member-1", displayName: "대표" },
      { userId: "member-2", displayName: "실장" },
      { userId: "member-3", displayName: "담당자" },
    ]);
  });
});
