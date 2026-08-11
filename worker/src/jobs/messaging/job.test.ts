import { describe, expect, it, vi } from "vitest";
import { processMessagingJob } from "./job.js";
import type { MessagingRecord } from "./types.js";

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

  it("normalizes failure without claiming, retrying, or persisting", async () => {
    const provider = { send: vi.fn(async () => ({ ok: false as const, reason: "발신번호 미등록", retryable: false })) };

    await expect(processMessagingJob(message, provider)).resolves.toEqual({
      outcome: "failed",
      messageId: "m1",
      reason: "발신번호 미등록",
      retryable: false,
    });
    expect(provider.send).toHaveBeenCalledOnce();
  });
});
