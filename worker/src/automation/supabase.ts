import type {
  AutomationJobData,
  AutomationOutcome,
  AutomationStorePort,
  MoveDecision,
} from "./types.js";

interface RpcRow {
  status: AutomationOutcome["status"];
  error_code: string | null;
  visited_rule_ids: string[];
}

export interface SupabaseAutomationConfig {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}

async function rpc(
  config: SupabaseAutomationConfig,
  name: string,
  body: Record<string, unknown>,
): Promise<RpcRow> {
  const response = await (config.fetchImpl ?? fetch)(
    `${config.url.replace(/\/$/u, "")}/rest/v1/rpc/${name}`,
    {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error(`automation_rpc_${response.status}`);
  const rows = await response.json() as RpcRow[];
  if (!rows[0]) throw new Error("automation_rpc_empty");
  return rows[0];
}

function outcome(
  job: AutomationJobData,
  decision: MoveDecision | null,
  row: RpcRow,
): AutomationOutcome {
  return {
    execution_key: job.execution_key,
    org_id: job.org_id,
    visited_rule_ids: row.visited_rule_ids,
    rule_id: decision?.rule_id ?? null,
    item_id: decision?.item_id ?? null,
    status: row.status,
    ...(row.error_code ? { error_code: row.error_code } : {}),
    ...(!decision ? { blocked_reasons: job.evaluation.blocked_reasons } : {}),
  };
}

export function createSupabaseAutomationStore(
  config: SupabaseAutomationConfig,
): AutomationStorePort {
  return {
    async executeMove(job) {
      const decision = job.evaluation.decision;
      const row = await rpc(config, "execute_board_automation_move", {
        p_execution_key: job.execution_key,
        p_org_id: job.org_id,
        p_rule_id: decision.rule_id,
        p_item_id: decision.item_id,
        p_from_group_id: decision.from_group_id,
        p_to_group_id: decision.to_group_id,
        p_visited_rule_ids: job.visited_rule_ids,
      });
      return outcome(job, decision, row);
    },
    async recordBlocked(job) {
      const decision = job.evaluation.decision;
      const row = await rpc(config, "record_board_automation_blocked", {
        p_execution_key: job.execution_key,
        p_org_id: job.org_id,
        p_rule_id: decision?.rule_id ?? null,
        p_item_id: decision?.item_id ?? null,
        p_blocked_reasons: job.evaluation.blocked_reasons,
        p_visited_rule_ids: job.visited_rule_ids,
      });
      return outcome(job, decision, row);
    },
  };
}

export function createSupabaseAutomationStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AutomationStorePort | null {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createSupabaseAutomationStore({ url, serviceRoleKey });
}
