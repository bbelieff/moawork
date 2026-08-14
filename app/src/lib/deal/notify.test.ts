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
    await expect(notifyFollowupRequested(ctx, "d1")).resolves.toMatchObject({
      status: "not_sent",
      reason: "unavailable",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each(["sent", "no_assignee", "self_assigned", "invalid_assignee"] as const)(
    "maps the RPC result %s without inventing success",
    async (result) => {
      mocks.rpc.mockResolvedValue({ data: result, error: null });
      const outcome = await notifyFollowupRequested(ctx, "d1");
      expect(outcome.status).toBe(result === "sent" ? "sent" : "not_sent");
      if (result !== "sent" && outcome.status === "not_sent") {
        expect(outcome.reason).toBe(result);
      }
    },
  );

  it("returns a typed failure for RPC errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(notifyFollowupRequested(ctx, "d1")).resolves.toMatchObject({
      status: "not_sent",
      reason: "rpc_error",
    });
  });

  it("returns a typed failure when the client throws", async () => {
    mocks.createClient.mockRejectedValue(new Error("network down"));
    await expect(notifyFollowupRequested(ctx, "d1")).resolves.toMatchObject({
      status: "not_sent",
      reason: "rpc_error",
    });
  });
});
