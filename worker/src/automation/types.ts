/**
 * Queue data is deliberately non-authoritative.  Only the database-issued
 * execution key crosses the worker boundary; tenant, item, rule, decision
 * and trace are re-derived inside the transactional RPC.
 */
export interface AutomationJobData {
  execution_key: string;
}

export type ExecutionStatus = "succeeded" | "failed" | "blocked" | "duplicate" | "rejected";

export interface AutomationOutcome {
  execution_key: string;
  status: ExecutionStatus;
  error_code?: string;
  visited_rule_ids: readonly string[];
}

/**
 * The migration 056 RPC is the authority boundary.  It accepts no caller
 * supplied organization, item, rule, target group, evaluation or trace.
 */
export interface AutomationStorePort {
  execute(executionKey: string): Promise<AutomationOutcome>;
}

/** There is currently no product event producer for this queue. */
export const AUTOMATION_PRODUCER_STATUS = "WORKER_REGISTERED_BUT_PRODUCER_NOT_READY" as const;
