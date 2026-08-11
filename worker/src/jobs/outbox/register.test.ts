import { describe, expect, it, vi } from "vitest";
import { createOutboxHandler } from "./register.js";
import type { DeliveryAdapter, OutboxStore } from "./types.js";

describe("outbox drain handler", () => {
  it("calls the provider adapter only for rows claimed by outbox", async () => {
    const deliver = vi.fn(async () => ({ ok: true as const, providerMessageId: "provider-id" }));
    const markDelivered = vi.fn(async () => undefined);
    const store: OutboxStore = {
      async claim() { return [{ outboxId: "outbox-id", messageId: "message-id", attempt: 1, actor: { kind: "person", id: "actor-id" } }]; },
      markDelivered,
      async markRetry() {},
      async markDead() {},
    };
    const adapter: DeliveryAdapter = { deliver };
    const result = await createOutboxHandler({ store, adapter, options: { workerId: "worker-id", wait: async () => undefined } })();
    expect(deliver).toHaveBeenCalledWith("message-id");
    expect(markDelivered).toHaveBeenCalledWith("outbox-id", "provider-id");
    expect(result.delivered).toBe(1);
  });
});
