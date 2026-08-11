import {
  MESSAGING_PROVIDER_FAILURE,
  type MessagingJobResult,
  type MessagingProvider,
  type MessagingRecord,
} from "./types.js";

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
    // Provider adapters are an external boundary. Never persist or return their
    // original error text even if a future adapter violates the TypeScript port.
    reason: result.retryable
      ? MESSAGING_PROVIDER_FAILURE.retry
      : MESSAGING_PROVIDER_FAILURE.failed,
    retryable: result.retryable,
  };
}
