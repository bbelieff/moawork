import { describe, expect, it, vi } from "vitest";
import type { MessagingProvider, MessagingRecord } from "../messaging/index.js";
import { createMessagingDeliveryAdapter, PostgresOutboxMessageLoader, type OutboxMessageLoader } from "./messaging-adapter.js";
import type { QueryPort } from "./store.js";

const message: MessagingRecord = {
  id: "message-1",
  channel: "sms",
  toDigits: "recipient",
  fromDigits: "sender",
  body: "body",
};
const delivery = {
  outboxId: "outbox-1", messageId: "message-1", attempt: 1,
  actor: { kind: "person" as const, id: "actor-1" }, workerId: "worker-1", leaseToken: "token-1",
};

describe("outbox messaging boundary", () => {
  it("loads payload only through the leased-worker RPC", async () => {
    const query = vi.fn(async () => ({ rows: [{
      id: "message-1", channel: "sms", to_addr: "recipient", from_addr: "sender",
      body_snapshot: "body", template_code: null, sender_profile_id: null,
    }] }));
    const loader = new PostgresOutboxMessageLoader({ query } as unknown as QueryPort);
    await expect(loader.load("message-1", "worker-1", "token-1")).resolves.toEqual(message);
    expect(query).toHaveBeenCalledWith(
      "select * from public.load_message_outbox_payload($1,$2,$3)",
      ["message-1", "worker-1", "token-1"],
    );
  });

  it("loads a claimed payload and calls the GT02 provider exactly once", async () => {
    const loader: OutboxMessageLoader = { load: vi.fn(async () => message) };
    const send = vi.fn(async () => ({ ok: true as const, providerMessageId: "receipt-1" }));
    const adapter = createMessagingDeliveryAdapter(loader, { send });
    await expect(adapter.deliver(delivery)).resolves.toEqual({ ok: true, providerMessageId: "receipt-1" });
    expect(loader.load).toHaveBeenCalledWith("message-1", "worker-1", "token-1");
    expect(send).toHaveBeenCalledOnce();
  });

  it("persists only GT02 normalized failure codes and quarantines ambiguous retry advice", async () => {
    const loader: OutboxMessageLoader = { load: vi.fn(async () => message) };
    const provider = { send: vi.fn(async () => ({ ok: false as const, reason: "private provider text", retryable: true })) };
    const adapter = createMessagingDeliveryAdapter(loader, provider as unknown as MessagingProvider);
    await expect(adapter.deliver(delivery)).resolves.toEqual({ ok: false, reason: "provider_retry", retryable: false });
  });

  it("does not call the provider when the payload is missing", async () => {
    const loader: OutboxMessageLoader = { load: vi.fn(async () => null) };
    const send = vi.fn();
    const adapter = createMessagingDeliveryAdapter(loader, { send } as MessagingProvider);
    await expect(adapter.deliver({ ...delivery, messageId: "missing" })).resolves.toEqual({ ok: false, reason: "message_not_found", retryable: false });
    expect(send).not.toHaveBeenCalled();
  });
});
