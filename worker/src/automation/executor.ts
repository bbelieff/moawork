import type { AutomationJobData, AutomationOutcome, AutomationStorePort } from "./types.js";

export interface AutomationExecutorDeps {
  store: AutomationStorePort;
}

export async function executeAutomation(
  deps: AutomationExecutorDeps,
  job: AutomationJobData,
): Promise<AutomationOutcome> {
  return deps.store.execute(job.execution_key);
}

/** Continue the batch, then preserve the first retry signal for pg-boss. */
export async function executeAutomationBatch(
  deps: AutomationExecutorDeps,
  jobs: readonly AutomationJobData[],
): Promise<AutomationOutcome[]> {
  const outcomes: AutomationOutcome[] = [];
  for (const job of jobs) {
    try {
      outcomes.push(await executeAutomation(deps, job));
    } catch (error) {
      outcomes.push({
        execution_key: job.execution_key,
        visited_rule_ids: [],
        status: "failed",
        error_code: error instanceof Error ? error.name : "automation_store_failed",
      });
    }
  }
  return outcomes;
}
