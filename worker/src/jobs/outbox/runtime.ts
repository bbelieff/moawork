import { randomUUID } from "node:crypto";
import type PgBoss from "pg-boss";
import { Pool } from "pg";
import { SolapiProvider } from "../messaging/index.js";
import { createMessagingDeliveryAdapter, PostgresOutboxMessageLoader } from "./messaging-adapter.js";
import { OUTBOX_DRAIN_QUEUE, registerOutboxWorker } from "./register.js";
import { PostgresOutboxStore, type QueryPort } from "./store.js";

export interface OutboxRuntime {
  stop(): Promise<void>;
}

export type OutboxEnvironment = Record<string, string | undefined>;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Starts dispatch only when the separately provisioned, non-bypass worker identity is present.
 * The general DATABASE_URL/service role is never reused for outbox mutation RPCs.
 */
export async function registerOutboxFromEnv(
  boss: PgBoss,
  env: OutboxEnvironment = process.env,
): Promise<OutboxRuntime | null> {
  const connectionString = env.OUTBOX_DATABASE_URL;
  const apiKey = env.SOLAPI_API_KEY;
  const apiSecret = env.SOLAPI_API_SECRET;
  if (!connectionString || !apiKey || !apiSecret) return null;

  const pool = new Pool({ connectionString, max: 2 });
  const db: QueryPort = { query: (sql, values) => pool.query(sql, values as unknown[]) };
  const workerId = env.OUTBOX_WORKER_ID?.trim() || `outbox-${randomUUID()}`;
  const store = new PostgresOutboxStore(db);
  const loader = new PostgresOutboxMessageLoader(db);
  const adapter = createMessagingDeliveryAdapter(loader, new SolapiProvider({ apiKey, apiSecret }));

  try {
    await registerOutboxWorker(boss, {
      store,
      adapter,
      options: {
        workerId,
        batchSize: positiveNumber(env.OUTBOX_BATCH_SIZE, 50),
        leaseMs: positiveNumber(env.OUTBOX_LEASE_MS, 60_000),
        sendsPerSecond: positiveNumber(env.OUTBOX_SENDS_PER_SECOND, 10),
        maxAttempts: positiveNumber(env.OUTBOX_MAX_ATTEMPTS, 5),
      },
    });
    await boss.schedule(OUTBOX_DRAIN_QUEUE, "* * * * *");
    return { stop: () => pool.end() };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
