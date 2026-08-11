import type {
  AutomationActionPort,
  AutomationHistoryPort,
  AutomationJobData,
  ExecutionHistoryEntry,
} from "./types.js";

const MAX_CHAIN_RULES = 32;

export interface AutomationExecutorDeps {
  actions: AutomationActionPort;
  history: AutomationHistoryPort;
  now?: () => Date;
}

export type AutomationOutcome = ExecutionHistoryEntry;

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return "automation_action_failed";
}

export async function executeAutomation(
  deps: AutomationExecutorDeps,
  job: AutomationJobData,
): Promise<AutomationOutcome> {
  const now = deps.now ?? (() => new Date());
  const attemptedAt = now().toISOString();
  const decision = job.evaluation.decision;

  if (!decision) {
    const blocked: ExecutionHistoryEntry = {
      execution_key: job.execution_key,
      rule_id: null,
      item_id: null,
      status: "blocked",
      attempted_at: attemptedAt,
      finished_at: now().toISOString(),
      blocked_reasons: job.evaluation.blocked_reasons,
    };
    await deps.history.append(blocked);
    return blocked;
  }

  const visited = job.visited_rule_ids ?? [];
  if (visited.includes(decision.rule_id) || visited.length >= MAX_CHAIN_RULES) {
    const loopBlocked: ExecutionHistoryEntry = {
      execution_key: job.execution_key,
      rule_id: decision.rule_id,
      item_id: decision.item_id,
      status: "blocked",
      attempted_at: attemptedAt,
      finished_at: now().toISOString(),
      error_code: "automation_loop_blocked",
      blocked_reasons: ["같은 실행 흐름에서 이미 처리한 규칙입니다."],
    };
    await deps.history.append(loopBlocked);
    return loopBlocked;
  }

  if (!(await deps.history.claim(job.execution_key, decision.rule_id))) {
    const duplicate: ExecutionHistoryEntry = {
      execution_key: job.execution_key,
      rule_id: decision.rule_id,
      item_id: decision.item_id,
      status: "duplicate",
      attempted_at: attemptedAt,
      finished_at: now().toISOString(),
      error_code: "automation_duplicate",
    };
    await deps.history.append(duplicate);
    return duplicate;
  }

  try {
    await deps.actions.moveItem(decision);
    const succeeded: ExecutionHistoryEntry = {
      execution_key: job.execution_key,
      rule_id: decision.rule_id,
      item_id: decision.item_id,
      status: "succeeded",
      attempted_at: attemptedAt,
      finished_at: now().toISOString(),
    };
    await deps.history.append(succeeded);
    return succeeded;
  } catch (error) {
    const failed: ExecutionHistoryEntry = {
      execution_key: job.execution_key,
      rule_id: decision.rule_id,
      item_id: decision.item_id,
      status: "failed",
      attempted_at: attemptedAt,
      finished_at: now().toISOString(),
      error_code: errorCode(error),
    };
    await deps.history.append(failed);
    return failed;
  }
}

/** A failing rule is contained so later rules in the same worker batch still run. */
export async function executeAutomationBatch(
  deps: AutomationExecutorDeps,
  jobs: readonly AutomationJobData[],
): Promise<AutomationOutcome[]> {
  const outcomes: AutomationOutcome[] = [];
  for (const job of jobs) outcomes.push(await executeAutomation(deps, job));
  return outcomes;
}
