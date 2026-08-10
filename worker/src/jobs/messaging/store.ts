import type { MessagingDispatchSource, MessagingRecord, MessagingStore } from "./types.js";

export interface QueryPort {
  query<T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

interface MessageRow extends Record<string, unknown> {
  id: string;
  status: "queued";
  channel: "sms" | "alimtalk";
  to_addr: string;
  from_addr: string;
  body_snapshot: string;
  template_code: string | null;
  sender_profile_id: string | null;
}

export class PostgresMessagingStore implements MessagingStore, MessagingDispatchSource {
  constructor(private readonly db: QueryPort) {}

  async listQueued(limit: number): Promise<readonly string[]> {
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const result = await this.db.query<{ id: string }>(
      "select id from public.messages where status='queued' and (claimed_at is null or claimed_at < now() - interval '15 minutes') order by created_at limit $1",
      [safeLimit],
    );
    return result.rows.map((row) => row.id);
  }

  async claim(messageId: string): Promise<MessagingRecord | null> {
    const result = await this.db.query<MessageRow>(
      `update public.messages m set claimed_at=now(), attempt_count=attempt_count+1
       from public.message_templates t
       where m.id=$1 and m.template_id=t.id and m.status='queued'
         and m.excluded_reason is null
         and (m.claimed_at is null or m.claimed_at < now() - interval '15 minutes')
       returning m.id,m.status,m.channel,m.to_addr,m.from_addr,m.body_snapshot,
         t.code as template_code,m.sender_profile_id`,
      [messageId],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      status: row.status,
      channel: row.channel,
      toDigits: row.to_addr,
      fromDigits: row.from_addr,
      body: row.body_snapshot,
      templateCode: row.template_code ?? undefined,
      senderProfileId: row.sender_profile_id ?? undefined,
    } : null;
  }

  async markSent(messageId: string, providerMessageId: string): Promise<void> {
    await this.db.query("update public.messages set status='sent',sent_at=now(),error=null,provider_message_id=$2 where id=$1", [messageId, providerMessageId]);
  }

  async markFailed(messageId: string, reason: string): Promise<void> {
    await this.db.query("update public.messages set status='failed',error=$2 where id=$1", [messageId, reason.slice(0, 300)]);
  }
}
