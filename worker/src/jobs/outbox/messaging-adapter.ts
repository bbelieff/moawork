import {
  processMessagingJob,
  type MessagingProvider,
  type MessagingRecord,
} from "../messaging/index.js";
import type { DeliveryAdapter, DeliveryResult } from "./types.js";
import type { QueryPort } from "./store.js";

export interface OutboxMessageLoader {
  load(messageId: string): Promise<MessagingRecord | null>;
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

  async load(messageId: string): Promise<MessagingRecord | null> {
    const result = await this.db.query<MessageRow>(
      `select m.id,m.channel,m.to_addr,m.from_addr,m.body_snapshot,
        t.code as template_code,m.sender_profile_id
       from public.messages m
       left join public.message_templates t
         on t.id=m.template_id and t.org_id=m.org_id
       where m.id=$1`,
      [messageId],
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
    async deliver(messageId: string): Promise<DeliveryResult> {
      const message = await loader.load(messageId);
      if (!message) return { ok: false, reason: "message_not_found", retryable: false };
      const result = await processMessagingJob(message, provider);
      return result.outcome === "sent"
        ? { ok: true, providerMessageId: result.providerMessageId }
        : { ok: false, reason: result.reason, retryable: result.retryable };
    },
  };
}
