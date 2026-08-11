import type PgBoss from "pg-boss";
import type { Job } from "pg-boss";
import { executeAutomationBatch, type AutomationExecutorDeps } from "./executor.js";
import { AUTOMATION_PRODUCER_STATUS, type AutomationJobData } from "./types.js";

export const AUTOMATION_EXECUTE_QUEUE = "automation.execute";
export { AUTOMATION_PRODUCER_STATUS };

export const AUTOMATION_QUEUE_OPTIONS = {
  name: AUTOMATION_EXECUTE_QUEUE,
  retryLimit: 3,
  retryBackoff: true,
} as const satisfies PgBoss.Queue;

export function isAutomationJobData(value: unknown): value is AutomationJobData {
  return Boolean(
    value && typeof value === "object"
      && typeof (value as { execution_key?: unknown }).execution_key === "string"
      && (value as { execution_key: string }).execution_key.trim().length > 0
      && Object.keys(value as object).every((key) => key === "execution_key"),
  );
}

export function createAutomationHandler(deps: AutomationExecutorDeps) {
  return async (jobs: Job<AutomationJobData>[]) => {
    const outcomes = await executeAutomationBatch(
      deps,
      jobs.map((job) => job.data).filter(isAutomationJobData),
    );
    if (outcomes.some((outcome) => outcome.status === "failed")) {
      throw new Error("automation_batch_retry");
    }
    return outcomes;
  };
}

export function automationSingletonKey(job: AutomationJobData): string {
  return JSON.stringify([job.execution_key]);
}

/** Future producer seam.  No current product path calls this function. */
export async function enqueueAutomation(boss: PgBoss, job: AutomationJobData): Promise<string | null> {
  return boss.send(AUTOMATION_EXECUTE_QUEUE, job, { singletonKey: automationSingletonKey(job) });
}

export async function registerAutomationWorker(boss: PgBoss, deps: AutomationExecutorDeps): Promise<void> {
  await boss.createQueue(AUTOMATION_EXECUTE_QUEUE, AUTOMATION_QUEUE_OPTIONS);
  await boss.work(AUTOMATION_EXECUTE_QUEUE, createAutomationHandler(deps));
}
