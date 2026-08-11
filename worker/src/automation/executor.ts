import type {
  AutomationJobData,
  AutomationOutcome,
  AutomationStorePort,
} from "./types.js";

const MAX_CHAIN_RULES = 32;

export interface AutomationExecutorDeps {
  store: AutomationStorePort;
}

export async function executeAutomation(
  deps: AutomationExecutorDeps,
  job: AutomationJobData,
): Promise<AutomationOutcome> {
  const decision = job.evaluation.decision;
  if (!decision) {
    return deps.store.recordBlocked({
      ...job,
      evaluation: { decision: null, blocked_reasons: job.evaluation.blocked_reasons },
    });
  }

  if (
    job.visited_rule_ids.includes(decision.rule_id)
    || job.visited_rule_ids.length >= MAX_CHAIN_RULES
  ) {
    return deps.store.recordBlocked({
      ...job,
      evaluation: { decision, blocked_reasons: ["같은 실행 흐름에서 이미 처리한 규칙입니다."] },
    });
  }

  return deps.store.executeMove({
    ...job,
    evaluation: { decision, blocked_reasons: job.evaluation.blocked_reasons },
  });
}

/** Store-level failures are contained so later rules in the same batch still run. */
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
        org_id: job.org_id,
        visited_rule_ids: job.visited_rule_ids,
        rule_id: job.evaluation.decision?.rule_id ?? null,
        item_id: job.evaluation.decision?.item_id ?? null,
        status: "failed",
        error_code: error instanceof Error ? error.name : "automation_store_failed",
      });
    }
  }
  return outcomes;
}
