import type PgBoss from "pg-boss";
import { executeOutboxBatch, type OutboxExecutorOptions } from "./executor.js";
import type { DeliveryAdapter, OutboxStore } from "./types.js";

export const OUTBOX_DRAIN_QUEUE = "message-outbox.drain";

export interface OutboxWorkerDeps {
  store: OutboxStore;
  adapter: DeliveryAdapter;
  options: OutboxExecutorOptions;
}

export const OUTBOX_QUEUE_OPTIONS = {
  name: OUTBOX_DRAIN_QUEUE,
  retryLimit: 0,
} as const satisfies PgBoss.Queue;

/** 외부 scheduler가 넣은 drain 신호 하나가 최대 100건만 처리한다. */
export function createOutboxHandler(deps: OutboxWorkerDeps) {
  return async () => executeOutboxBatch(deps.store, deps.adapter, deps.options);
}

export async function registerOutboxWorker(boss: PgBoss, deps: OutboxWorkerDeps): Promise<void> {
  await boss.createQueue(OUTBOX_DRAIN_QUEUE, OUTBOX_QUEUE_OPTIONS);
  await boss.work(OUTBOX_DRAIN_QUEUE, createOutboxHandler(deps));
}
