import { describe, expect, it, vi } from "vitest";
import { WorkManagementSource, WorkManagementUnavailableError } from "./workManagementSource";

describe("WorkManagementSource", () => {
  it("loads a tenant-bound empty board through the exact read RPC contract", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        board: {
          id: "work-management:org-a",
          orgId: "org-a",
          title: "업무관리",
          icon: "work",
          templateKey: "work-management",
          templateVersion: 1,
          baselineFingerprint: "baseline",
          currentFingerprint: "current",
        },
        groups: [],
        columns: [],
        items: [],
        members: [],
        views: [],
        virtualBindings: [],
        role: "manager",
        filesEnabled: false,
      },
      error: null,
    });

    const result = await new WorkManagementSource({ rpc }).load("org-a");

    expect(result.items).toEqual([]);
    expect(result.board.orgId).toBe("org-a");
    expect(rpc).toHaveBeenCalledWith("read_work_management_board", { p_org_id: "org-a" });
  });

  it("fails closed when the foundation RPC is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "missing" } });
    await expect(new WorkManagementSource({ rpc }).load("org-a")).rejects.toBeInstanceOf(WorkManagementUnavailableError);
  });

  it("passes CAS and replay fields only through the narrow command RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { accepted: true, replayed: false, version: 4 }, error: null });
    const result = await new WorkManagementSource({ rpc }).execute({ operation: "set_due_date", orgId: "o", boardId: "b", itemId: "i", expectedVersion: 3, requestId: "00000000-0000-4000-8000-000000000001", payload: { due_date: "2026-08-04" } });
    expect(result.version).toBe(4);
    expect(rpc).toHaveBeenCalledWith("execute_work_management_command", expect.objectContaining({ p_expected_version: 3, p_request_id: "00000000-0000-4000-8000-000000000001" }));
  });

  it("rejects a response that is not bound to the requested tenant", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { board: { id: "b", orgId: "org-b" }, groups: [], columns: [], items: [], members: [], views: [], virtualBindings: [], role: "viewer", filesEnabled: false }, error: null });
    await expect(new WorkManagementSource({ rpc }).load("org-a")).rejects.toThrow("tenant");
  });

  it("fails closed on malformed nested rows and missing bindings", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { board: { id: "b", orgId: "org-a" }, groups: [], columns: [], items: [null], members: [], views: [], role: "viewer", filesEnabled: false }, error: null });
    await expect(new WorkManagementSource({ rpc }).load("org-a")).rejects.toBeInstanceOf(WorkManagementUnavailableError);
  });
});
