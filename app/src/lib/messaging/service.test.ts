import { describe, expect, it, vi } from "vitest";
import { MessagingService, messageIdempotencyKey, phoneDigits } from "./service";
import type { MessageBatchCommand, MessageOutboxPort } from "./types";

const command = (count: number): MessageBatchCommand => ({
  orgId: "org-1",
  batchKey: "batch-1",
  columnKey: "absence_message",
  value: "간편 부재 1회",
  channel: "sms",
  templateCode: "absence-simple-1",
  targets: Array.from({ length: count }, (_, index) => ({
    entityId: `item-${index}`,
    phone: "010-1234-5678",
  })),
});

describe("MessagingService", () => {
  it("stores digits only and makes retries of one transition idempotent", () => {
    expect(phoneDigits("010-1234-5678")).toBe("01012345678");
    const key = messageIdempotencyKey({ orgId: "o", entityId: "e", columnKey: "c", value: "v" });
    expect(key).toBe(messageIdempotencyKey({ orgId: "o", entityId: "e", columnKey: "c", value: "v" }));
    expect(key).not.toBe(messageIdempotencyKey({ orgId: "o", entityId: "next", columnKey: "c", value: "v" }));
  });

  it("deduplicates the same business action across different requests", async () => {
    const seen = new Set<string>();
    const reserve = vi.fn(async (input) => {
      const outcome = seen.has(input.idempotencyKey) ? "duplicate" as const : "queued" as const;
      seen.add(input.idempotencyKey);
      return { outcome, messageId: "m1" };
    });
    const outbox: MessageOutboxPort = {
      reserve,
      markQueueFailed: vi.fn(async () => undefined),
      finishBatch: vi.fn(async () => "batch-id"),
    };
    const queue = { enqueue: vi.fn(async () => undefined) };
    const first = command(1);
    const second = {
      ...command(1),
      batchKey: "another-request",
      targets: command(1).targets,
    };

    await expect(new MessagingService(outbox, queue).enqueueBatch(first)).resolves.toMatchObject({ queued: 1, duplicate: 0 });
    await expect(new MessagingService(outbox, queue).enqueueBatch(second)).resolves.toMatchObject({ queued: 0, duplicate: 1 });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it.each([1, 1000])("routes %i targets through the same batch function", async (count) => {
    const reserve = vi.fn(async (input) => ({ outcome: "queued" as const, messageId: input.entityId }));
    const outbox: MessageOutboxPort = { reserve, markQueueFailed: vi.fn(async () => undefined), finishBatch: vi.fn(async () => "batch-id") };
    const enqueue = vi.fn(async () => undefined);
    const result = await new MessagingService(outbox, { enqueue }).enqueueBatch(command(count));
    expect(reserve).toHaveBeenCalledTimes(count);
    expect(enqueue).toHaveBeenCalledTimes(count);
    expect(result).toMatchObject({ requested: count, queued: count, duplicate: 0, excluded: 0, failed: 0 });
  });

  it("returns queued, duplicate, excluded and failed counts without hiding partial failure", async () => {
    const outcomes = [
      { outcome: "queued" as const, messageId: "m1" },
      { outcome: "duplicate" as const, messageId: "m1" },
      { outcome: "excluded" as const, reason: "수신 거부" },
      { outcome: "failed" as const, reason: "템플릿 미승인" },
    ];
    const outbox: MessageOutboxPort = {
      reserve: vi.fn(async () => outcomes.shift()!),
      markQueueFailed: vi.fn(async () => undefined),
      finishBatch: vi.fn(async () => "batch-id"),
    };
    const result = await new MessagingService(outbox, { enqueue: vi.fn(async () => undefined) }).enqueueBatch(command(4));
    expect(result).toEqual({ batchId: "batch-id", requested: 4, queued: 1, duplicate: 1, excluded: 1, failed: 1 });
  });

  it("persists a queue failure instead of silently dropping it", async () => {
    const markQueueFailed = vi.fn(async () => undefined);
    const outbox: MessageOutboxPort = {
      reserve: vi.fn(async () => ({ outcome: "queued" as const, messageId: "m1" })),
      markQueueFailed,
      finishBatch: vi.fn(async () => "batch-id"),
    };
    const result = await new MessagingService(outbox, { enqueue: vi.fn(async () => { throw new Error("down"); }) }).enqueueBatch(command(1));
    expect(markQueueFailed).toHaveBeenCalledWith("m1", "발송 작업을 큐에 넣지 못했어요.");
    expect(result).toMatchObject({ queued: 0, failed: 1 });
  });
});
