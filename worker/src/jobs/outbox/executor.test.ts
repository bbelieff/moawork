import { describe, expect, it } from "vitest";
import { executeOutboxBatch, retryDelayMs } from "./executor.js";
import { businessMessageKey } from "./idempotency.js";
import type { DeliveryAdapter, OutboxDelivery, OutboxStore } from "./types.js";

class MemoryStore implements OutboxStore {
  readonly pending = new Map<string, OutboxDelivery>();
  delivered = 0;
  retrying = 0;
  dead = 0;

  enqueue(job: OutboxDelivery) { this.pending.set(job.outboxId, job); }
  async claim(limit: number) { return [...this.pending.values()].slice(0, limit); }
  async markDelivered(id: string) { this.pending.delete(id); this.delivered += 1; }
  async markRetry(id: string) { this.pending.delete(id); this.retrying += 1; }
  async markDead(id: string) { this.pending.delete(id); this.dead += 1; }
}

const actor = { kind: "automation", id: "rule-1" } as const;

describe("message outbox", () => {
  it("uses a transaction-independent business idempotency key", () => {
    const input = { orgId: "org", sourceEntityId: "deal", triggerColumnKey: "absence", triggerValueId: "simple-1", templateId: "tpl", channel: "sms" } as const;
    expect(businessMessageKey(input)).toBe(businessMessageKey({ ...input }));
    expect(businessMessageKey({ ...input, triggerValueId: "malicious" })).not.toBe(businessMessageKey(input));
  });

  it("keeps a 1,000 item ingress bounded to 100 claims and rate limits delivery", async () => {
    const store = new MemoryStore();
    for (let index = 0; index < 1_000; index += 1) store.enqueue({ outboxId: `o-${index}`, messageId: `m-${index}`, attempt: 1, actor });
    const waits: number[] = [];
    const adapter: DeliveryAdapter = { async deliver() { return { ok: true, providerMessageId: "accepted" }; } };
    const summary = await executeOutboxBatch(store, adapter, { workerId: "w", batchSize: 1_000, sendsPerSecond: 20, wait: async (ms) => { waits.push(ms); } });
    expect(summary).toEqual({ claimed: 100, delivered: 100, retrying: 0, dead: 0 });
    expect(store.pending.size).toBe(900);
    expect(waits).toHaveLength(99);
    expect(waits.every((value) => value === 50)).toBe(true);
  });

  it("retries transient failures with backoff and stops permanent failures", async () => {
    const store = new MemoryStore();
    store.enqueue({ outboxId: "retry", messageId: "m-1", attempt: 2, actor });
    store.enqueue({ outboxId: "dead", messageId: "m-2", attempt: 1, actor });
    const adapter: DeliveryAdapter = { async deliver(id) { return id === "m-1" ? { ok: false, reason: "busy", retryable: true } : { ok: false, reason: "invalid", retryable: false }; } };
    const summary = await executeOutboxBatch(store, adapter, { workerId: "w", wait: async () => undefined, random: () => 0 });
    expect(summary).toEqual({ claimed: 2, delivered: 0, retrying: 1, dead: 1 });
    expect(retryDelayMs(2, () => 0)).toBe(2_000);
  });
});
