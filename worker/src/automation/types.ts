/** GT04's pure-condition output consumed by the worker. */
export interface MoveDecision {
  item_id: string;
  from_group_id: string | null;
  to_group_id: string;
  rule_id: string;
}

export interface AutomationEvaluation {
  decision: MoveDecision | null;
  blocked_reasons: readonly string[];
}

export interface AutomationTrace {
  execution_key: string;
  org_id: string;
  visited_rule_ids: readonly string[];
}

export interface AutomationJobData extends AutomationTrace {
  evaluation: AutomationEvaluation;
}

export type ExecutionStatus = "succeeded" | "failed" | "blocked" | "duplicate";

export interface AutomationOutcome extends AutomationTrace {
  rule_id: string | null;
  item_id: string | null;
  status: ExecutionStatus;
  error_code?: string;
  blocked_reasons?: readonly string[];
}

/** Atomic persistence boundary implemented by migration 051. */
export interface AutomationStorePort {
  executeMove(job: AutomationJobData & { evaluation: { decision: MoveDecision; blocked_reasons: readonly string[] } }): Promise<AutomationOutcome>;
  recordBlocked(job: AutomationJobData): Promise<AutomationOutcome>;
}

export function nextAutomationJob(
  parent: AutomationJobData,
  evaluation: AutomationEvaluation,
): AutomationJobData {
  const ruleId = parent.evaluation.decision?.rule_id;
  return {
    execution_key: parent.execution_key,
    org_id: parent.org_id,
    visited_rule_ids: ruleId
      ? [...parent.visited_rule_ids, ruleId]
      : [...parent.visited_rule_ids],
    evaluation,
  };
}
