import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  hasSupabaseEnv: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ hasSupabaseEnv: mocks.hasSupabaseEnv }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { notifyFollowupRequested } from "./notify";

const ctx = { user: { id: "u1" }, org: { id: "o1" } } as Ctx;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasSupabaseEnv.mockReturnValue(true);
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
});

describe("notifyFollowupRequested", () => {
  it("returns a typed unavailable outcome when Supabase is not configured", async () => {
    mocks.hasSupabaseEnv.mockReturnValue(false);
    await expect(notifyFollowupRequested(ctx, "d1", "c1")).resolves.toMatchObject({
      status: "not_sent",
      reason: "unavailable",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each(["sent", "duplicate", "no_assignee", "self_assigned", "invalid_assignee"] as const)(
    "maps the RPC result %s without inventing success",
    async (result) => {
      mocks.rpc.mockResolvedValue({ data: result, error: null });
      const outcome = await notifyFollowupRequested(ctx, "d1", "c1");
      expect(outcome.status).toBe(
        result === "sent" || result === "duplicate" ? "sent" : "not_sent",
      );
      if (result !== "sent" && result !== "duplicate" && outcome.status === "not_sent") {
        expect(outcome.reason).toBe(result);
      }
    },
  );

  it("returns a typed failure for RPC errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(notifyFollowupRequested(ctx, "d1", "c1")).resolves.toMatchObject({
      status: "not_sent",
      reason: "rpc_error",
    });
  });

  it("returns a typed failure when the client throws", async () => {
    mocks.createClient.mockRejectedValue(new Error("network down"));
    await expect(notifyFollowupRequested(ctx, "d1", "c1")).resolves.toMatchObject({
      status: "not_sent",
      reason: "rpc_error",
    });
  });

  it("passes the caller-owned comment event key to the database", async () => {
    mocks.rpc.mockResolvedValue({ data: "sent", error: null });
    await notifyFollowupRequested(ctx, "d1", "comment-event-1");
    expect(mocks.rpc).toHaveBeenCalledWith("request_deal_followup", {
      p_org_id: "o1",
      p_deal_id: "d1",
      p_event_key: "comment-event-1",
    });
  });
});
