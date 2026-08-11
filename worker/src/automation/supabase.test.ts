import { describe, expect, it, vi } from "vitest";
import { createSupabaseAutomationStore, createSupabaseAutomationStoreFromEnv } from "./supabase.js";

describe("Supabase automation store", () => {
  it("executes move, atomic claim and history through one RPC", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{
      status: "succeeded", error_code: null, visited_rule_ids: ["rule-a"],
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    const store = createSupabaseAutomationStore({
      url: "https://example.supabase.co/", serviceRoleKey: "test-only", fetchImpl,
    });
    const result = await store.executeMove({
      execution_key: "event-1", org_id: "org-1", visited_rule_ids: [],
      evaluation: {
        decision: { item_id: "item-1", from_group_id: "new", to_group_id: "contact", rule_id: "rule-a" },
        blocked_reasons: [],
      },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/rpc/execute_board_automation_move");
    expect(result).toMatchObject({ status: "succeeded", visited_rule_ids: ["rule-a"] });
  });

  it("does not configure without both environment variables", () => {
    expect(createSupabaseAutomationStoreFromEnv({})).toBeNull();
  });
});
