import type { MessagingJobData, MessagingJobResult, MessagingProvider, MessagingStore } from "./types.js";

export const MESSAGING_QUEUE = "messaging.send";

export async function processMessagingJob(
  data: MessagingJobData,
  deps: { store: MessagingStore; provider: MessagingProvider },
): Promise<MessagingJobResult> {
  const message = await deps.store.claim(data.messageId);
  if (!message) return { outcome: "duplicate", messageId: data.messageId };

  const result = await deps.provider.send(message);
  if (result.ok) {
    await deps.store.markSent(message.id, result.providerMessageId);
    return { outcome: "sent", messageId: message.id };
  }
  if (result.retryable) throw new Error("메시지 발송을 잠시 후 다시 시도해요.");

  await deps.store.markFailed(message.id, result.reason);
  return { outcome: "failed", messageId: message.id, reason: result.reason };
}

export async function retryFailedMessages(
  messageIds: readonly string[],
  enqueue: (messageId: string) => Promise<void>,
): Promise<number> {
  for (const messageId of messageIds) await enqueue(messageId);
  return messageIds.length;
}
