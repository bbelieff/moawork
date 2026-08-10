import { describe, expect, it, vi } from "vitest";
import { processMessagingJob, retryFailedMessages } from "./job.js";
import type { MessagingRecord, MessagingStore } from "./types.js";

const message: MessagingRecord = {
  id: "m1",
  status: "sending",
  channel: "sms",
  toDigits: "01012345678",
  fromDigits: "0212345678",
  body: "안내 메시지",
};

function store(claimed: MessagingRecord | null): MessagingStore {
  return { claim: vi.fn(async () => claimed), markSent: vi.fn(async () => undefined), markFailed: vi.fn(async () => undefined) };
}

describe("messaging worker", () => {
  it("does not send a message that was already claimed or sent", async () => {
    const provider = { send: vi.fn() };
    await expect(processMessagingJob({ messageId: "m1" }, { store: store(null), provider })).resolves.toEqual({ outcome: "duplicate", messageId: "m1" });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("persists permanent failure reason", async () => {
    const sink = store(message);
    const result = await processMessagingJob({ messageId: "m1" }, { store: sink, provider: { send: vi.fn(async () => ({ ok: false as const, reason: "발신번호 미등록", retryable: false })) } });
    expect(result).toEqual({ outcome: "failed", messageId: "m1", reason: "발신번호 미등록" });
    expect(sink.markFailed).toHaveBeenCalledWith("m1", "발신번호 미등록");
  });

  it("requeues only the failed ids selected by the caller", async () => {
    const enqueue = vi.fn(async () => undefined);
    await expect(retryFailedMessages(["failed-1", "failed-3"], enqueue)).resolves.toBe(2);
    expect(enqueue.mock.calls.flat()).toEqual(["failed-1", "failed-3"]);
  });
});
