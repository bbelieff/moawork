import { describe, expect, it, vi } from "vitest";
import { readOwnerWorkspaceDeletionRows, WorkspaceDeletionUnavailableError } from "./server";

describe("workspace deletion RPC adapter", () => {
  it("keeps active and pending owner rows distinct", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [
      { org_id: "a", name: "활성 회사", slug: "active", status: "active", role: "owner", deletion_requested_at: null },
      { org_id: "b", name: "정리 예정", slug: "pending", status: "pending_delete", role: "owner", deletion_requested_at: "2026-08-22T01:00:00Z" },
    ], error: null });

    await expect(readOwnerWorkspaceDeletionRows({ rpc })).resolves.toEqual([
      { orgId: "a", name: "활성 회사", slug: "active", status: "active", role: "owner", deletionRequestedAt: null },
      { orgId: "b", name: "정리 예정", slug: "pending", status: "pending_delete", role: "owner", deletionRequestedAt: "2026-08-22T01:00:00Z" },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_my_workspaces");
  });

  it.each([
    [{ data: null, error: { message: "denied" } }],
    [{ data: null, error: null }],
    [{ data: [{ org_id: "a", name: "A", slug: "a", status: "active", role: "admin", deletion_requested_at: null }], error: null }],
  ])("fails closed instead of disguising an RPC failure as an empty list", async (result) => {
    await expect(readOwnerWorkspaceDeletionRows({ rpc: vi.fn().mockResolvedValue(result) }))
      .rejects.toBeInstanceOf(WorkspaceDeletionUnavailableError);
  });
});
