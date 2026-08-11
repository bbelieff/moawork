import type { MessagingJobResult, MessagingProvider, MessagingRecord } from "./types.js";

/** One delivery attempt. Claim, retry, and persistence belong to the outbox executor. */
export async function processMessagingJob(
  message: MessagingRecord,
  provider: MessagingProvider,
): Promise<MessagingJobResult> {
  const result = await provider.send(message);
  if (result.ok) {
    return {
      outcome: "sent",
      messageId: message.id,
      providerMessageId: result.providerMessageId,
    };
  }

  return {
    outcome: "failed",
    messageId: message.id,
    reason: result.reason,
    retryable: result.retryable,
  };
}
