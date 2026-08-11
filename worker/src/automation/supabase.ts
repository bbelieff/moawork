import type { AutomationOutcome, AutomationStorePort } from "./types.js";

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

async function rpc(config: SupabaseAutomationConfig, executionKey: string): Promise<RpcRow> {
  const response = await (config.fetchImpl ?? fetch)(
    `${config.url.replace(/\/$/u, "")}/rest/v1/rpc/execute_trusted_board_automation`,
    {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_execution_key: executionKey }),
    },
  );
  if (!response.ok) throw new Error(`automation_rpc_${response.status}`);
  const rows = await response.json() as RpcRow[];
  if (!rows[0] || !Array.isArray(rows[0].visited_rule_ids)) throw new Error("automation_rpc_invalid");
  return rows[0];
}

export function createSupabaseAutomationStore(config: SupabaseAutomationConfig): AutomationStorePort {
  return {
    async execute(executionKey) {
      const row = await rpc(config, executionKey);
      return {
        execution_key: executionKey,
        status: row.status,
        visited_rule_ids: row.visited_rule_ids,
        ...(row.error_code ? { error_code: row.error_code } : {}),
      };
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
