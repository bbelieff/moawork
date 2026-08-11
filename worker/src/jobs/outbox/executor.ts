import type { DeliveryAdapter, OutboxRunSummary, OutboxStore } from "./types.js";

export interface OutboxExecutorOptions {
  workerId: string;
  batchSize?: number;
  leaseMs?: number;
  sendsPerSecond?: number;
  maxAttempts?: number;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function retryDelayMs(attempt: number, random = Math.random): number {
  const exponent = Math.max(0, Math.min(10, attempt - 1));
  const base = Math.min(15 * 60_000, 1_000 * 2 ** exponent);
  return base + Math.floor(base * 0.2 * random());
}

/** Provider 오류가 수신번호를 되비쳐도 outbox 감사 데이터에 남기지 않는다. */
export function safeFailureReason(reason: string): string {
  const scrubbed = reason.replace(/\d[\d\s()+-]{7,}\d/g, "[redacted]").trim();
  return (scrubbed || "발송 처리 중 오류가 발생했어요.").slice(0, 300);
}

export async function executeOutboxBatch(
  store: OutboxStore,
  adapter: DeliveryAdapter,
  options: OutboxExecutorOptions,
): Promise<OutboxRunSummary> {
  const batchSize = Math.max(1, Math.min(100, Math.trunc(options.batchSize ?? 50)));
  const leaseMs = Math.max(5_000, options.leaseMs ?? 60_000);
  const sendsPerSecond = Math.max(0.1, options.sendsPerSecond ?? 10);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? sleep;
  const random = options.random ?? Math.random;
  const spacingMs = Math.ceil(1_000 / sendsPerSecond);
  const jobs = await store.claim(batchSize, options.workerId, leaseMs);
  const summary: OutboxRunSummary = { claimed: jobs.length, delivered: 0, retrying: 0, dead: 0 };

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (index > 0) await wait(spacingMs);
    try {
      const result = await adapter.deliver(job.messageId);
      if (result.ok) {
        await store.markDelivered(job.outboxId, result.providerMessageId);
        summary.delivered += 1;
      } else if (result.retryable && job.attempt < maxAttempts) {
        const next = new Date(now().getTime() + retryDelayMs(job.attempt, random));
        await store.markRetry(job.outboxId, safeFailureReason(result.reason), next);
        summary.retrying += 1;
      } else {
        await store.markDead(job.outboxId, safeFailureReason(result.reason));
        summary.dead += 1;
      }
    } catch (error) {
      const reason = safeFailureReason(error instanceof Error ? error.message : "발송 처리 중 알 수 없는 오류가 발생했어요.");
      if (job.attempt < maxAttempts) {
        const next = new Date(now().getTime() + retryDelayMs(job.attempt, random));
        await store.markRetry(job.outboxId, reason, next);
        summary.retrying += 1;
      } else {
        await store.markDead(job.outboxId, reason);
        summary.dead += 1;
      }
    }
  }
  return summary;
}
