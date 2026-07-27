import { describe, expect, it, vi } from "vitest";
import { readWorkspaceRoutingSnapshot } from "./workspace-entry-server";

function membership(orgId: string, slug: string, status = "active") {
  return {
    org_id: orgId,
    status,
    role: "member",
    scope: "assigned",
    created_at: "2026-01-01T00:00:00.000Z",
    orgs: {
      id: orgId,
      slug,
      status: "active",
      name: `회사 ${orgId}`,
      plan_tier: "t1_3",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

function client(rows: unknown[], user: { id: string } | null = { id: "user-1" }) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn(() => ({ select })),
  };
}

describe("auth-only workspace routing loader", () => {
  it.each([
    [0, []],
    [1, [membership("org-1", "alpha-team")]],
    [2, [membership("org-1", "alpha-team"), membership("org-2", "beta-team")]],
  ])("loads %i active memberships without a selected mw_org", async (count, rows) => {
    const result = await readWorkspaceRoutingSnapshot(client(rows));
    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind === "ready") expect(result.memberships).toHaveLength(count);
  });

  it("excludes inactive rows and fails closed for malformed relations", async () => {
    await expect(readWorkspaceRoutingSnapshot(client([membership("org-1", "alpha-team", "suspended")]))).resolves.toEqual({ kind: "ready", memberships: [] });
    await expect(readWorkspaceRoutingSnapshot(client([{ org_id: "org-1", status: "active", orgs: null }]))).resolves.toEqual({ kind: "error" });
  });

  it("does not treat an unauthenticated visitor as a zero-membership user", async () => {
    await expect(readWorkspaceRoutingSnapshot(client([], null))).resolves.toEqual({ kind: "unauthenticated" });
  });
});
