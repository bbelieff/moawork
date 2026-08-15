import { describe, expect, it, vi } from "vitest";
import { SupabaseCampaignOutbox } from "./supabase";

function clientFor(options: { failAt?: number; duplicateAt?: number } = {}) {
  let rpcCount = 0;
  let lastRows: Array<Record<string, unknown>> = [];
  const bulkSelect = vi.fn(async () => ({ data: lastRows.map((row, index) => ({ id: `m-${index}`, idempotency_key: row.idempotency_key })), error: null }));
  const upsert = vi.fn((rows: Array<Record<string, unknown>>) => { lastRows = rows; return { select: bulkSelect }; });
  const existingIn = vi.fn(async (_field: string, keys: string[]) => ({ data: keys.map((key, index) => ({ id: `m-${index}`, idempotency_key: key })), error: null }));
  const existingEq = vi.fn(() => ({ in: existingIn }));
  const messageSelect = vi.fn(() => ({ eq: existingEq }));
  const templateSingle = vi.fn(async () => ({ data: { id: "template-a", channel: "sms", body: "안내", status: "approved" }, error: null }));
  const templateEq3 = vi.fn(() => ({ single: templateSingle }));
  const templateEq2 = vi.fn(() => ({ eq: templateEq3 }));
  const templateEq1 = vi.fn(() => ({ eq: templateEq2 }));
  const templateSelect = vi.fn(() => ({ eq: templateEq1 }));
  const rpc = vi.fn(async () => {
    rpcCount += 1;
    return rpcCount === options.failAt
      ? { data: null, error: { message: "reservation failed" } }
      : { data: [{ outbox_id: `o-${rpcCount}`, inserted: rpcCount !== options.duplicateAt }], error: null };
  });
  const client = {
    from: vi.fn((table: string) => table === "message_templates"
      ? { select: templateSelect }
      : { upsert, select: messageSelect }),
    rpc,
  } as never;
  return { client, upsert, rpc, existingIn };
}

const input = (count: number) => ({
  orgId: "org-a", actorId: "user-a", templateId: "template-a", channel: "sms" as const,
  senderDigits: "0212345678", campaignKey: "campaign-a", filterSnapshotHash: "hash-a",
  targets: Array.from({ length: count }, (_, index) => ({ itemId: `item-${index}`, phoneDigits: `010${String(index).padStart(8, "0")}` })),
});

describe("BBE-30 bounded outbox adapter", () => {
  it("bulk-inserts each bounded chunk and only reserves delivery; it never calls a paid provider", async () => {
    const { client, upsert, rpc } = clientFor();
    const adapter = new SupabaseCampaignOutbox(client, 2);
    expect(await adapter.enqueue(input(3))).toEqual({ queued: 3, duplicate: 0, failed: 0 });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0]).toHaveLength(2);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(Object.keys(client)).toEqual(expect.not.arrayContaining(["send", "provider"]));
  });

  it("bounds 10k message inserts to 50 chunks instead of 20k sequential data requests", async () => {
    const { client, upsert, rpc, existingIn } = clientFor();
    const result = await new SupabaseCampaignOutbox(client, 200).enqueue(input(10_000));
    expect(result).toEqual({ queued: 10_000, duplicate: 0, failed: 0 });
    expect(upsert).toHaveBeenCalledTimes(50);
    expect(existingIn).toHaveBeenCalledTimes(50);
    expect(rpc).toHaveBeenCalledTimes(10_000);
  });

  it("reports a partial reservation failure explicitly without sending", async () => {
    const { client } = clientFor({ failAt: 2 });
    expect(await new SupabaseCampaignOutbox(client, 3).enqueue(input(3)))
      .toEqual({ queued: 2, duplicate: 0, failed: 1 });
  });

  it("reports a BBE-30 business-key retry as duplicate", async () => {
    const { client } = clientFor({ duplicateAt: 2 });
    expect(await new SupabaseCampaignOutbox(client, 3).enqueue(input(3)))
      .toEqual({ queued: 2, duplicate: 1, failed: 0 });
  });
});
