import { describe, expect, it, vi } from "vitest";
import type { MessagingProvider, MessagingRecord } from "../messaging/index.js";
import { createMessagingDeliveryAdapter, type OutboxMessageLoader } from "./messaging-adapter.js";

const message: MessagingRecord = {
  id: "message-1",
  channel: "sms",
  toDigits: "recipient",
  fromDigits: "sender",
  body: "body",
};

describe("outbox messaging boundary", () => {
  it("loads a claimed payload and calls the GT02 provider exactly once", async () => {
    const loader: OutboxMessageLoader = { load: vi.fn(async () => message) };
    const send = vi.fn(async () => ({ ok: true as const, providerMessageId: "receipt-1" }));
    const adapter = createMessagingDeliveryAdapter(loader, { send });
    await expect(adapter.deliver("message-1")).resolves.toEqual({ ok: true, providerMessageId: "receipt-1" });
    expect(loader.load).toHaveBeenCalledWith("message-1");
    expect(send).toHaveBeenCalledOnce();
  });

  it("passes only GT02 normalized failure codes into outbox retry", async () => {
    const loader: OutboxMessageLoader = { load: vi.fn(async () => message) };
    const provider = { send: vi.fn(async () => ({ ok: false as const, reason: "private provider text", retryable: true })) };
    const adapter = createMessagingDeliveryAdapter(loader, provider as unknown as MessagingProvider);
    await expect(adapter.deliver("message-1")).resolves.toEqual({ ok: false, reason: "provider_retry", retryable: true });
  });

  it("does not call the provider when the payload is missing", async () => {
    const loader: OutboxMessageLoader = { load: vi.fn(async () => null) };
    const send = vi.fn();
    const adapter = createMessagingDeliveryAdapter(loader, { send } as MessagingProvider);
    await expect(adapter.deliver("missing")).resolves.toEqual({ ok: false, reason: "message_not_found", retryable: false });
    expect(send).not.toHaveBeenCalled();
  });
});
