import type PgBoss from "pg-boss";
import type { Job } from "pg-boss";
import {
  executeAutomationBatch,
  type AutomationExecutorDeps,
} from "./executor.js";
import type { AutomationJobData } from "./types.js";

export const AUTOMATION_EXECUTE_QUEUE = "automation.execute";

export const AUTOMATION_QUEUE_OPTIONS = {
  name: AUTOMATION_EXECUTE_QUEUE,
  retryLimit: 3,
  retryBackoff: true,
} as const satisfies PgBoss.Queue;

export function createAutomationHandler(deps: AutomationExecutorDeps) {
  return async (jobs: Job<AutomationJobData>[]) => {
    // pg-boss persists the returned value as job output, in addition to the
    // injected history port's queryable audit records.
    return executeAutomationBatch(deps, jobs.map((job) => job.data));
  };
}

export async function registerAutomationWorker(
  boss: PgBoss,
  deps: AutomationExecutorDeps,
): Promise<void> {
  await boss.createQueue(AUTOMATION_EXECUTE_QUEUE, AUTOMATION_QUEUE_OPTIONS);
  await boss.work(AUTOMATION_EXECUTE_QUEUE, createAutomationHandler(deps));
}
