import { describe, expect, it, vi } from "vitest";
import { createSupabaseAutomationStore, createSupabaseAutomationStoreFromEnv } from "./supabase.js";

describe("Supabase automation store", () => {
  it("sends only the opaque execution key to the trusted RPC", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{
      status: "succeeded", error_code: null, visited_rule_ids: ["rule-a"],
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    const store = createSupabaseAutomationStore({
      url: "https://example.supabase.co/", serviceRoleKey: "test-only", fetchImpl,
    });
    const result = await store.execute("event-1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/rpc/execute_trusted_board_automation");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ body: '{"p_execution_key":"event-1"}' });
    expect(result).toMatchObject({ status: "succeeded", visited_rule_ids: ["rule-a"] });
  });

  it("does not configure without both environment variables", () => {
    expect(createSupabaseAutomationStoreFromEnv({})).toBeNull();
  });
});
