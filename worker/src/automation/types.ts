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

export interface AutomationJobData {
  evaluation: AutomationEvaluation;
  /** Stable identifier for one originating item change. */
  execution_key: string;
  /** Rules already executed for this event chain. */
  visited_rule_ids?: readonly string[];
}

export type ExecutionStatus = "succeeded" | "failed" | "blocked" | "duplicate";

export interface ExecutionHistoryEntry {
  execution_key: string;
  rule_id: string | null;
  item_id: string | null;
  status: ExecutionStatus;
  attempted_at: string;
  finished_at: string;
  error_code?: string;
  blocked_reasons?: readonly string[];
}

export interface AutomationActionPort {
  moveItem(decision: MoveDecision): Promise<void>;
}

export interface AutomationHistoryPort {
  /** Must atomically return false when execution_key + rule_id was recorded already. */
  claim(executionKey: string, ruleId: string): Promise<boolean>;
  append(entry: ExecutionHistoryEntry): Promise<void>;
}
