import type PgBoss from "pg-boss";
import type { Job } from "pg-boss";
import { MESSAGING_QUEUE, processMessagingJob } from "./job.js";
import type { MessagingDispatchSource, MessagingJobData, MessagingProvider, MessagingStore } from "./types.js";

export const MESSAGING_RETRY_POLICY = {
  retryLimit: 5,
  retryDelay: 15,
  retryBackoff: true,
} as const;

export async function registerMessagingWorker(
  boss: PgBoss,
  deps: { store: MessagingStore; provider: MessagingProvider },
): Promise<void> {
  await boss.createQueue(MESSAGING_QUEUE);
  await boss.work<MessagingJobData>(MESSAGING_QUEUE, async (jobs: Job<MessagingJobData>[]) => {
    for (const job of jobs) await processMessagingJob(job.data, deps);
  });
}

export async function enqueueMessagingJob(boss: PgBoss, messageId: string): Promise<string | null> {
  return boss.send(MESSAGING_QUEUE, { messageId }, MESSAGING_RETRY_POLICY);
}

export async function dispatchMessagingOutbox(
  boss: PgBoss,
  source: MessagingDispatchSource,
  limit = 1000,
): Promise<number> {
  const ids = await source.listQueued(limit);
  for (const id of ids) await enqueueMessagingJob(boss, id);
  return ids.length;
}
