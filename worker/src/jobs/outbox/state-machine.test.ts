import { describe, expect, it, vi } from "vitest";
import { executeOutboxBatch } from "./executor.js";
import { businessMessageKey, type BusinessMessageKey } from "./idempotency.js";
import type { OutboxDelivery, OutboxStore } from "./types.js";

interface Row extends OutboxDelivery {
  key: string;
  status: "pending" | "leased" | "retry" | "delivered" | "dead";
  nextAt: number;
  leaseUntil: number;
}

class ExecutableOutbox implements OutboxStore {
  private readonly rows = new Map<string, Row>();
  now = 0;

  enqueue(input: BusinessMessageKey, messageId: string): { inserted: boolean; outboxId: string } {
    const key = businessMessageKey(input);
    const existing = [...this.rows.values()].find((row) => row.key === key);
    if (existing) return { inserted: false, outboxId: existing.outboxId };
    const outboxId = `outbox-${this.rows.size + 1}`;
    this.rows.set(outboxId, {
      key, outboxId, messageId, attempt: 0,
      actor: { kind: "automation", id: "rule" },
      status: "pending", nextAt: this.now, leaseUntil: 0,
    });
    return { inserted: true, outboxId };
  }

  async claim(limit: number, _workerId: string, leaseMs: number): Promise<readonly OutboxDelivery[]> {
    const claimed: Row[] = [];
    for (const row of this.rows.values()) {
      const available = (row.status === "pending" || row.status === "retry") && row.nextAt <= this.now;
      const expired = row.status === "leased" && row.leaseUntil <= this.now;
      if ((!available && !expired) || claimed.length >= limit) continue;
      row.status = "leased";
      row.leaseUntil = this.now + leaseMs;
      row.attempt += 1;
      claimed.push(row);
    }
    return claimed.map(({ outboxId, messageId, attempt, actor }) => ({ outboxId, messageId, attempt, actor }));
  }

  async markDelivered(id: string) { this.rows.get(id)!.status = "delivered"; }
  async markRetry(id: string, _reason: string, next: Date) {
    const row = this.rows.get(id)!;
    row.status = "retry";
    row.nextAt = next.getTime();
  }
  async markDead(id: string) { this.rows.get(id)!.status = "dead"; }
  status(id: string) { return this.rows.get(id)!.status; }
}

const key: BusinessMessageKey = {
  orgId: "org", sourceEntityId: "deal", triggerColumnKey: "absence",
  triggerValueId: "simple-1", templateId: "template", channel: "sms",
};

describe("executable outbox state machine", () => {
  it("inserts the same cross-transaction business event once and pays the provider once", async () => {
    const store = new ExecutableOutbox();
    expect(store.enqueue(key, "message-1").inserted).toBe(true);
    expect(store.enqueue({ ...key }, "message-2").inserted).toBe(false);
    const deliver = vi.fn(async () => ({ ok: true as const, providerMessageId: "receipt" }));
    const result = await executeOutboxBatch(store, { deliver }, { workerId: "worker", wait: async () => undefined });
    expect(result).toEqual({ claimed: 1, delivered: 1, retrying: 0, dead: 0 });
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith("message-1");
  });

  it("atomically gives a row to only one concurrent claimant", async () => {
    const store = new ExecutableOutbox();
    store.enqueue(key, "message-1");
    const [first, second] = await Promise.all([
      store.claim(100, "worker-a", 60_000),
      store.claim(100, "worker-b", 60_000),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("reclaims a retry only after backoff and increments attempt", async () => {
    const store = new ExecutableOutbox();
    const { outboxId } = store.enqueue(key, "message-1");
    const deliver = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, reason: "provider_retry", retryable: true })
      .mockResolvedValueOnce({ ok: true as const, providerMessageId: "receipt" });
    await executeOutboxBatch(store, { deliver }, {
      workerId: "worker", now: () => new Date(store.now), random: () => 0, wait: async () => undefined,
    });
    expect(store.status(outboxId)).toBe("retry");
    expect(await store.claim(1, "early", 60_000)).toHaveLength(0);
    store.now = 1_000;
    const result = await executeOutboxBatch(store, { deliver }, {
      workerId: "worker", now: () => new Date(store.now), random: () => 0, wait: async () => undefined,
    });
    expect(result.delivered).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});
