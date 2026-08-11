import type { OutboxDelivery, OutboxStore } from "./types.js";

export interface QueryPort {
  query<T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

interface ClaimedRow extends Record<string, unknown> {
  outbox_id: string;
  message_id: string;
  attempt_count: number;
  actor_kind: "person" | "automation";
  actor_id: string;
}

export class PostgresOutboxStore implements OutboxStore {
  constructor(private readonly db: QueryPort) {}

  async claim(limit: number, workerId: string, leaseMs: number): Promise<readonly OutboxDelivery[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const result = await this.db.query<ClaimedRow>(
      "select * from public.claim_message_outbox($1,$2,$3)",
      [safeLimit, workerId, Math.max(5_000, Math.trunc(leaseMs))],
    );
    return result.rows.map((row) => ({
      outboxId: row.outbox_id,
      messageId: row.message_id,
      attempt: row.attempt_count,
      actor: { kind: row.actor_kind, id: row.actor_id },
    }));
  }

  async markDelivered(outboxId: string, providerMessageId: string): Promise<void> {
    await this.db.query("select public.complete_message_outbox($1,$2)", [outboxId, providerMessageId]);
  }

  async markRetry(outboxId: string, reason: string, nextAttemptAt: Date): Promise<void> {
    await this.db.query("select public.retry_message_outbox($1,$2,$3)", [outboxId, reason.slice(0, 300), nextAttemptAt]);
  }

  async markDead(outboxId: string, reason: string): Promise<void> {
    await this.db.query("select public.fail_message_outbox($1,$2)", [outboxId, reason.slice(0, 300)]);
  }
}
