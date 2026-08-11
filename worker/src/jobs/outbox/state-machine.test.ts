import { describe, expect, it, vi } from "vitest";
import { executeOutboxBatch } from "./executor.js";
import { businessMessageKey, type BusinessMessageKey } from "./idempotency.js";
import type { OutboxDelivery, OutboxStore } from "./types.js";

interface Row extends OutboxDelivery {
  key: string;
  status: "pending" | "leased" | "retry" | "delivered" | "dead";
  nextAt: number;
  leaseUntil: number;
  deliveryStarted: boolean;
}

class ExecutableOutbox implements OutboxStore {
  private readonly rows = new Map<string, Row>();
  now = 0;
  tokenSequence = 0;

  enqueue(input: BusinessMessageKey, messageId: string): { inserted: boolean; outboxId: string } {
    const key = businessMessageKey(input);
    const existing = [...this.rows.values()].find((row) => row.key === key);
    if (existing) return { inserted: false, outboxId: existing.outboxId };
    const outboxId = `outbox-${this.rows.size + 1}`;
    this.rows.set(outboxId, {
      key, outboxId, messageId, attempt: 0,
      actor: { kind: "automation", id: "rule" },
      status: "pending", nextAt: this.now, leaseUntil: 0,
      workerId: "", leaseToken: "",
      deliveryStarted: false,
    });
    return { inserted: true, outboxId };
  }

  async claim(limit: number, workerId: string, leaseMs: number): Promise<readonly OutboxDelivery[]> {
    const claimed: Row[] = [];
    for (const row of this.rows.values()) {
      const available = (row.status === "pending" || row.status === "retry") && row.nextAt <= this.now;
      const expired = row.status === "leased" && row.leaseUntil <= this.now;
      if (expired && row.deliveryStarted) {
        row.status = "dead";
        continue;
      }
      if ((!available && !expired) || claimed.length >= limit) continue;
      row.status = "leased";
      row.leaseUntil = this.now + leaseMs;
      row.attempt += 1;
      row.workerId = workerId;
      row.leaseToken = `token-${++this.tokenSequence}`;
      claimed.push(row);
    }
    return claimed.map(({ outboxId, messageId, attempt, actor, workerId: owner, leaseToken }) => ({ outboxId, messageId, attempt, actor, workerId: owner, leaseToken }));
  }

  private leased(delivery: OutboxDelivery): Row {
    const row = this.rows.get(delivery.outboxId)!;
    if (row.status !== "leased" || row.leaseUntil <= this.now || row.workerId !== delivery.workerId || row.leaseToken !== delivery.leaseToken) {
      throw new Error("invalid_lease");
    }
    return row;
  }

  async markDeliveryStarted(delivery: OutboxDelivery) {
    const row = this.leased(delivery);
    if (row.deliveryStarted) throw new Error("delivery_already_started");
    row.deliveryStarted = true;
  }

  async markDelivered(delivery: OutboxDelivery, _providerMessageId?: string) { this.leased(delivery).status = "delivered"; }
  async markRetry(delivery: OutboxDelivery, _reason: string, next: Date) {
    const row = this.leased(delivery);
    row.status = "retry";
    row.nextAt = next.getTime();
    row.deliveryStarted = false;
  }
  async markDead(delivery: OutboxDelivery, _reason?: string) { this.leased(delivery).status = "dead"; }
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
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ messageId: "message-1", workerId: "worker" }));
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

  it("rejects worker/token mismatch, expiry, and all stale ACKs after re-claim", async () => {
    const store = new ExecutableOutbox();
    const { outboxId } = store.enqueue(key, "message-1");
    const first = (await store.claim(1, "worker-a", 100))[0];
    await expect(store.markDelivered({ ...first, workerId: "worker-x" }, "receipt")).rejects.toThrow("invalid_lease");
    await expect(store.markRetry({ ...first, leaseToken: "wrong" }, "retry", new Date(200))).rejects.toThrow("invalid_lease");
    store.now = 100;
    await expect(store.markDead(first, "expired")).rejects.toThrow("invalid_lease");

    const second = (await store.claim(1, "worker-b", 100))[0];
    for (const stale of [
      () => store.markDelivered(first, "receipt"),
      () => store.markRetry(first, "retry", new Date(300)),
      () => store.markDead(first, "dead"),
    ]) await expect(stale()).rejects.toThrow("invalid_lease");
    expect(store.status(outboxId)).toBe("leased");
    await expect(store.markDelivered(second, "receipt")).resolves.toBeUndefined();
    expect(store.status(outboxId)).toBe("delivered");
  });

  it("never calls the paid provider again after success-before-ack crash", async () => {
    const store = new ExecutableOutbox();
    store.enqueue(key, "message-1");
    const first = (await store.claim(1, "worker-a", 100))[0];
    const provider = vi.fn(async (_delivery: OutboxDelivery) => ({ ok: true as const, providerMessageId: "receipt" }));

    await store.markDeliveryStarted(first);
    await provider(first); // process exits here, before markDelivered
    store.now = 100;

    const reclaimed = await store.claim(1, "worker-b", 100);
    expect(reclaimed).toHaveLength(0);
    expect(store.status(first.outboxId)).toBe("dead");
    expect(provider).toHaveBeenCalledOnce();
  });
});
