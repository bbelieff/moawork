import { describe, expect, it, vi } from "vitest";
import { processMessagingJob } from "./job.js";
import type { MessagingProvider, MessagingRecord } from "./types.js";

const message: MessagingRecord = {
  id: "m1",
  channel: "sms",
  toDigits: "01012345678",
  fromDigits: "0212345678",
  body: "안내 메시지",
};

describe("messaging delivery adapter", () => {
  it("calls the provider exactly once and returns its receipt", async () => {
    const provider = { send: vi.fn(async () => ({ ok: true as const, providerMessageId: "provider-1" })) };

    await expect(processMessagingJob(message, provider)).resolves.toEqual({
      outcome: "sent",
      messageId: "m1",
      providerMessageId: "provider-1",
    });
    expect(provider.send).toHaveBeenCalledOnce();
  });

  it("discards external failure text before returning a persistence-safe outcome", async () => {
    const sensitive = "https://provider.invalid/sign?token=private user@example.invalid";
    const provider = {
      send: vi.fn(async () => ({
        ok: false as const,
        reason: sensitive,
        retryable: false,
      })),
    };

    const result = await processMessagingJob(
      message,
      provider as unknown as MessagingProvider,
    );
    expect(result).toEqual({
      outcome: "failed",
      messageId: "m1",
      reason: "provider_failed",
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain(sensitive);
    expect(provider.send).toHaveBeenCalledOnce();
  });

  it("uses the fixed retry code for retryable provider failures", async () => {
    const provider = {
      send: vi.fn(async () => ({
        ok: false as const,
        reason: "https://provider.invalid/retry?token=private",
        retryable: true,
      })),
    };

    await expect(
      processMessagingJob(message, provider as unknown as MessagingProvider),
    ).resolves.toEqual({
      outcome: "failed",
      messageId: "m1",
      reason: "provider_retry",
      retryable: true,
    });
  });
});
