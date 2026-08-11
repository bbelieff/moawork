import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  risky: vi.fn(),
  rpc: vi.fn(),
  order: [] as string[],
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, role: "member" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: mocks.rpc })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: mocks.risky }));

import { applyCsv, saveAutomationDraft } from "./workspace-ops-actions";

const id = "10000000-0000-4000-8000-000000000001";

describe("workspace operation permission enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.guard.mockImplementation(async () => {
      mocks.order.push("guard");
      return { kind: "allowed" };
    });
    mocks.risky.mockImplementation(async () => {
      mocks.order.push("audit");
      return { ok: true };
    });
    mocks.rpc.mockImplementation(async () => {
      mocks.order.push("operation");
      return { data: { accepted: true }, error: null };
    });
  });

  it("blocks an automation mutation before its product RPC", async () => {
    mocks.guard.mockResolvedValue({ kind: "denied", reason: "permission" });
    const result = await saveAutomationDraft(id, id, {}, id);
    expect(result.ok).toBe(false);
    expect(mocks.guard).toHaveBeenCalledWith("org-a", "automation.edit");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records a data-import risk before executing the product RPC", async () => {
    const result = await applyCsv(id);
    expect(result.ok).toBe(true);
    expect(mocks.guard).toHaveBeenCalledWith("org-a", "danger.data_import");
    expect(mocks.risky).toHaveBeenCalledWith("org-a", "danger.data_import", { operation: "apply_workspace_csv_batch" });
    expect(mocks.order).toEqual(["guard", "audit", "operation"]);
  });

  it("fails closed when the mandatory risk audit cannot be written", async () => {
    mocks.risky.mockResolvedValue({ ok: false });
    const result = await applyCsv(id);
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
