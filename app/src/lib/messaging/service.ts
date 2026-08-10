import { createHash } from "node:crypto";
import type {
  MessageBatchCommand,
  MessageBatchResult,
  MessageOutboxPort,
  MessageQueuePort,
  MessageReservationInput,
} from "./types";

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function messageIdempotencyKey(input: {
  orgId: string;
  entityId: string;
  columnKey: string;
  value: string;
  transitionId: string;
}): string {
  return createHash("sha256")
    .update([input.orgId, input.entityId, input.columnKey, input.value, input.transitionId].join("\u001f"))
    .digest("hex");
}

export class MessagingService {
  constructor(
    private readonly outbox: MessageOutboxPort,
    private readonly queue: MessageQueuePort,
  ) {}

  async enqueueBatch(command: MessageBatchCommand): Promise<MessageBatchResult> {
    const counts = { requested: command.targets.length, queued: 0, duplicate: 0, excluded: 0, failed: 0 };

    for (const target of command.targets) {
      const digits = phoneDigits(target.phone);
      if (digits.length < 9 || digits.length > 12) {
        counts.failed += 1;
        continue;
      }
      const input: MessageReservationInput = {
        orgId: command.orgId,
        batchKey: command.batchKey,
        entityId: target.entityId,
        phoneDigits: digits,
        idempotencyKey: messageIdempotencyKey({
          orgId: command.orgId,
          entityId: target.entityId,
          columnKey: command.columnKey,
          value: command.value,
          transitionId: target.transitionId,
        }),
        columnKey: command.columnKey,
        value: command.value,
        channel: command.channel,
        templateCode: command.templateCode,
      };
      try {
        const reservation = await this.outbox.reserve(input);
        counts[reservation.outcome] += 1;
        if (reservation.outcome === "queued") {
          try {
            await this.queue.enqueue(reservation.messageId);
          } catch {
            await this.outbox.markQueueFailed(reservation.messageId, "발송 작업을 큐에 넣지 못했어요.");
            counts.queued -= 1;
            counts.failed += 1;
          }
        }
      } catch {
        counts.failed += 1;
      }
    }

    const batchId = await this.outbox.finishBatch(command.batchKey, counts);
    return { batchId, ...counts };
  }
}
