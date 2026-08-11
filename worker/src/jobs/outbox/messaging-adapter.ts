import {
  processMessagingJob,
  type MessagingProvider,
  type MessagingRecord,
} from "../messaging/index.js";
import type { DeliveryAdapter, DeliveryResult, OutboxDelivery } from "./types.js";
import type { QueryPort } from "./store.js";

export interface OutboxMessageLoader {
  load(messageId: string, workerId: string, leaseToken: string): Promise<MessagingRecord | null>;
}

interface MessageRow extends Record<string, unknown> {
  id: string;
  channel: "sms" | "alimtalk";
  to_addr: string;
  from_addr: string;
  body_snapshot: string;
  template_code: string | null;
  sender_profile_id: string | null;
}

/** Payload 조회만 담당한다. claim/attempt 상태는 PostgresOutboxStore만 변경한다. */
export class PostgresOutboxMessageLoader implements OutboxMessageLoader {
  constructor(private readonly db: QueryPort) {}

  async load(messageId: string, workerId: string, leaseToken: string): Promise<MessagingRecord | null> {
    const result = await this.db.query<MessageRow>(
      "select * from public.load_message_outbox_payload($1,$2,$3)",
      [messageId, workerId, leaseToken],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      channel: row.channel,
      toDigits: row.to_addr,
      fromDigits: row.from_addr,
      body: row.body_snapshot,
      templateCode: row.template_code ?? undefined,
      senderProfileId: row.sender_profile_id ?? undefined,
    } : null;
  }
}

/** GT02 processMessagingJob을 정확히 한 번 호출하는 provider 경계 adapter다. */
export function createMessagingDeliveryAdapter(
  loader: OutboxMessageLoader,
  provider: MessagingProvider,
): DeliveryAdapter {
  return {
    async deliver(delivery: OutboxDelivery): Promise<DeliveryResult> {
      const message = await loader.load(delivery.messageId, delivery.workerId, delivery.leaseToken);
      if (!message) return { ok: false, reason: "message_not_found", retryable: false };
      const result = await processMessagingJob(message, provider);
      return result.outcome === "sent"
        ? { ok: true, providerMessageId: result.providerMessageId }
        : {
            ok: false,
            reason: result.reason,
            // GT02 owns provider result normalization. Until that contract can
            // prove a failure was rejected before admission, outbox must treat
            // it as ambiguous and prefer manual reconciliation over double cost.
            retryable: false,
          };
    },
  };
}
