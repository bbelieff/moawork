import { createClient } from "@/lib/supabase/server";
import type { CsvImportScope } from "./csv-import";
import type { DynamicWorkspaceDraft, DynamicWorkspacePublication } from "./domain";

export type FunctionalMvpAvailability =
  | { kind: "ready"; draft: DynamicWorkspaceDraft; publication: DynamicWorkspacePublication | null }
  | { kind: "pending"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string };

export type FunctionalMvpServerScope = Readonly<{ orgId: string; workspaceId: string; userId: string; isOwner: boolean }>;
export type WorkspaceOpsRpcClient = { rpc(name: string, params?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };
export type WorkspaceOpsResult = Readonly<{ accepted: boolean; replayed?: boolean; status?: string; state?: string }>;

const unavailableMessage = "운영 데이터 RPC가 아직 적용되지 않아 초안만 확인할 수 있어요. 적용·되돌리기·자동화 활성화는 사용할 수 없어요.";

function accepted(data: unknown): WorkspaceOpsResult | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  return value.accepted === true ? { accepted: true, replayed: value.replayed === true, status: typeof value.status === "string" ? value.status : undefined, state: typeof value.state === "string" ? value.state : undefined } : null;
}

async function call(client: WorkspaceOpsRpcClient, name: string, params: Record<string, unknown>): Promise<WorkspaceOpsResult | null> {
  const result = await client.rpc(name, params);
  return result.error ? null : accepted(result.data);
}

/** Actual 010 mutation RPC shapes. Pages do not call these until hosted 010 is available. */
export const workspaceOpsRpc = {
  saveBuilder: (client: WorkspaceOpsRpcClient, orgId: string, configuration: unknown, requestId: string) => call(client, "save_workspace_builder_config", { p_org_id: orgId, p_configuration: configuration, p_request_id: requestId }),
  createCsvDryRun: (client: WorkspaceOpsRpcClient, batchId: string, orgId: string, boardId: string, rows: unknown[], requestId: string) => call(client, "create_workspace_csv_dry_run", { p_batch_id: batchId, p_org_id: orgId, p_board_id: boardId, p_rows: rows, p_request_id: requestId }),
  applyCsv: (client: WorkspaceOpsRpcClient, batchId: string) => call(client, "apply_workspace_csv_batch", { p_batch_id: batchId }),
  rollbackCsv: (client: WorkspaceOpsRpcClient, batchId: string) => call(client, "rollback_workspace_csv_batch", { p_batch_id: batchId }),
  saveAutomationDraft: (client: WorkspaceOpsRpcClient, automationId: string, orgId: string, boardId: string, draft: unknown, requestId: string) => call(client, "save_workspace_automation_draft", { p_automation_id: automationId, p_org_id: orgId, p_board_id: boardId, p_draft: draft, p_request_id: requestId }),
  activateAutomation: (client: WorkspaceOpsRpcClient, automationId: string) => call(client, "activate_workspace_automation", { p_automation_id: automationId }),
};

/** No 010 read RPC exists; this stays honest until the hosted migration and a server read contract are both live. */
export async function loadFunctionalMvpAvailability(scope: FunctionalMvpServerScope): Promise<FunctionalMvpAvailability> {
  if (!scope.isOwner) return { kind: "error", message: "대표 권한을 확인할 수 없어요." };
  return { kind: "unavailable", message: unavailableMessage };
}

export function functionalMvpCsvScope(scope: FunctionalMvpServerScope): CsvImportScope {
  return { orgId: scope.orgId, workspaceId: scope.workspaceId, sourceId: "csv-paste-awaiting-hosted-010", mappingVersion: "010-rpc-pending-v1" };
}

/** Server-only factory retained for the DATA apply gate; no browser authority or service role is used. */
export async function loadWorkspaceOpsClient(): Promise<WorkspaceOpsRpcClient> {
  return await createClient() as unknown as WorkspaceOpsRpcClient;
}
