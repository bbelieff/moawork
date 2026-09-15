import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ hasSupabaseEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { loadNotifySnapshot, markAllRead } from "./server";
const ctx = { org: { id: "org-test" }, user: { id: "user-test" }, scope: "all" } as Ctx;
function port(errorTable?: string) {
  const calls: Array<[string, string, unknown[]]> = [];
  const from = (table: string) => {
    const result = { data: table === "audit_logs" ? [{ target_type: "deal" }] : [], error: table === errorTable ? { message: "rejected" } : null };
    const query: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ["select", "update", "eq", "is", "order", "limit", "upsert"]) query[method] = (...args: unknown[]) => { calls.push([table, method, args]); return query; };
    return query;
  };
  return { from, calls };
}
beforeEach(() => vi.clearAllMocks());
describe("notification center persistence errors", () => {
  it("distinguishes a failed load from an empty inbox", async () => {
    mocks.createClient.mockResolvedValue(port("notifications"));
    expect(await loadNotifySnapshot(ctx)).toMatchObject({ loadError: true, mine: [], org: [] });
  });
  it("rejects a failed read update instead of showing success", async () => {
    mocks.createClient.mockResolvedValue(port("notifications"));
    await expect(markAllRead(ctx)).rejects.toThrow("읽음 상태");
  });
  it("reports a failed feed watermark write", async () => {
    mocks.createClient.mockResolvedValue(port("notification_surface_seen"));
    await expect(markAllRead(ctx)).rejects.toThrow("읽음 상태");
  });
  it("updates only this user's unread rows without resolving work", async () => {
    const client = port(); mocks.createClient.mockResolvedValue(client);
    await markAllRead(ctx, new Date("2026-09-15T00:00:00Z"));
    expect(client.calls).toContainEqual(["notifications", "eq", ["org_id", "org-test"]]);
    expect(client.calls).toContainEqual(["notifications", "eq", ["user_id", "user-test"]]);
    expect(client.calls).toContainEqual(["notifications", "is", ["read_at", null]]);
    expect(client.calls.find(([table, method]) => table === "notifications" && method === "update")?.[2]).toEqual([{ read_at: "2026-09-15T00:00:00.000Z" }]);
  });
});
