import { describe, expect, it, vi } from "vitest";
import { SupabaseBoardsRepo } from "./boardsRepo";

const ctx = { org: { id: "org" }, user: { id: "user" }, role: "owner", scope: "all" } as const;
const request = { requestId: "00000000-0000-4000-8000-000000000001", intent: { type: "remove" as const, metricId: "status" } };

describe("Issue #605 Supabase summary repository", () => {
  it("uses the narrow authenticated RPC and validates its canonical result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ config: [{ id: "amount", kind: "sum", columnKey: "amount" }], replayed: false }], error: null });
    const repo = new SupabaseBoardsRepo({ rpc } as never);
    await expect(repo.applyBoardSummarySettings(ctx as never, "board", request)).resolves.toEqual({ config: [{ id: "amount", kind: "sum", columnKey: "amount" }], replayed: false });
    expect(rpc).toHaveBeenCalledWith("apply_board_summary_settings", { p_org_id: "org", p_board_id: "board", p_request_id: request.requestId, p_intent: request.intent });
  });

  it("rejects malformed or duplicate RPC configs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ config: [
      { id: "same", kind: "sum", columnKey: "amount" },
      { id: "same", kind: "sum", columnKey: "quantity" },
    ], replayed: true }], error: null });
    await expect(new SupabaseBoardsRepo({ rpc } as never).applyBoardSummarySettings(ctx as never, "board", request)).rejects.toThrow(/중복/);
  });
});
