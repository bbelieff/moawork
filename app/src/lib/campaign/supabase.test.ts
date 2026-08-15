import { describe, expect, it, vi } from "vitest";
import { SupabaseCampaignOutbox } from "./supabase";

describe("BBE-30 outbox adapter", () => {
  it("uses tenant/business identity and only reserves delivery; it never calls a paid provider", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "message-a" }, error: null });
    const select = vi.fn(() => ({ maybeSingle }));
    const upsert = vi.fn(() => ({ select }));
    const rpc = vi.fn().mockResolvedValue({ data: [{ outbox_id: "outbox-a", inserted: true }], error: null });
    const templateSingle = vi.fn().mockResolvedValue({ data: { id: "template-a", channel: "sms", body: "안내", status: "approved" }, error: null });
    const templateEq3 = vi.fn(() => ({ single: templateSingle }));
    const templateEq2 = vi.fn(() => ({ eq: templateEq3 }));
    const templateEq1 = vi.fn(() => ({ eq: templateEq2 }));
    const templateSelect = vi.fn(() => ({ eq: templateEq1 }));
    const client = { from: vi.fn((table: string) => table === "message_templates" ? { select: templateSelect } : { upsert }), rpc } as never;
    const adapter = new SupabaseCampaignOutbox(client);
    expect(await adapter.enqueue({ orgId: "org-a", actorId: "user-a", templateId: "template-a", channel: "sms", senderDigits: "0212345678", campaignKey: "campaign-a", filterSnapshotHash: "hash-a", targets: [{ itemId: "item-a", phoneDigits: "01011112222" }] })).toEqual({ queued: 1, duplicate: 0 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ org_id: "org-a", source_entity_id: "item-a", body_snapshot: "안내", from_addr: "0212345678", trigger_column_key: "retargeting", trigger_value: "campaign-a:hash-a" }), expect.objectContaining({ onConflict: "org_id,idempotency_key" }));
    expect(rpc).toHaveBeenCalledWith("enqueue_message_outbox", expect.objectContaining({ p_org_id: "org-a", p_source_entity_id: "item-a", p_actor_id: "user-a" }));
    expect(Object.keys(client)).toEqual(expect.not.arrayContaining(["send", "provider"]));
  });
});
