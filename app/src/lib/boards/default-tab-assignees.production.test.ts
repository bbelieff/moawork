import { beforeEach, describe, expect, it, vi } from "vitest";

const loadMemberOrgSummary = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/env", () => ({ hasSupabaseEnv: () => true }));
vi.mock("@/lib/auth/member-org-summary", () => ({ loadMemberOrgSummary }));

import { loadDefaultTabAssignees } from "./default-tab-assignees";
import type { Ctx } from "@/lib/types";

const ctx = {
  org: { id: "org-production", name: "운영 회사" },
  user: { id: "owner-1", name: "대표", email: "owner@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

describe("loadDefaultTabAssignees production", () => {
  beforeEach(() => loadMemberOrgSummary.mockReset());

  it("LocalRepo가 아니라 인증된 org_members 요약을 사용한다", async () => {
    loadMemberOrgSummary.mockResolvedValue({
      kind: "ready",
      owner: {
        orgId: ctx.org.id,
        userId: "owner-1",
        displayName: "대표",
        role: "owner",
        scope: "all",
        title: null,
        teamKey: null,
        createdAt: "2026-08-14T00:00:00Z",
      },
      admins: [],
      members: [],
    });
    await expect(loadDefaultTabAssignees(ctx)).resolves.toEqual([
      { userId: "owner-1", displayName: "대표" },
    ]);
    expect(loadMemberOrgSummary).toHaveBeenCalledWith(ctx);
  });
});
