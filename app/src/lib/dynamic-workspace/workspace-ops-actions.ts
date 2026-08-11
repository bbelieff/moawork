"use server";

import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadPermGuard } from "@/lib/perm/guard";
import { recordRiskyAction } from "@/lib/perm/server";

export type WorkspaceOpsAction = Readonly<{ ok: boolean; message: string; id?: string }>;
type RpcClient = { rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function invoke(
  name: string,
  params: (orgId: string) => Record<string, unknown>,
  permissionKey: string,
  id?: string,
  riskKey?: "danger.data_import",
): Promise<WorkspaceOpsAction> {
  const ctx = await getSession();
  const permission = await loadPermGuard(ctx.org.id, permissionKey);
  if (permission.kind !== "allowed") {
    return { ok: false, message: permission.reason === "permission" ? "이 업무를 실행할 권한이 없어요." : "권한을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요." };
  }
  // 위험 작업은 실제 RPC보다 먼저 감사 원장에 기록한다. 기록 실패 시 원 작업도 실행하지 않는다.
  if (riskKey && !(await recordRiskyAction(ctx.org.id, riskKey, { operation: name })).ok) {
    return { ok: false, message: "위험 작업 기록을 남기지 못해 실행하지 않았어요." };
  }
  const client = await createClient() as unknown as RpcClient;
  const result = await client.rpc(name, params(ctx.org.id));
  const value = result.data as { accepted?: unknown } | null;
  return !result.error && value?.accepted === true ? { ok: true, message: "서버 요청을 완료했습니다.", id } : { ok: false, message: "서버 요청을 완료하지 못했습니다. 다시 시도해 주세요." };
}

export async function saveBuilder(configuration: Record<string, unknown>, requestId: string) {
  if (!UUID.test(requestId)) return { ok: false, message: "요청 식별자가 올바르지 않습니다." };
  return invoke("save_workspace_builder_config", (orgId) => ({ p_org_id: orgId, p_configuration: configuration, p_request_id: requestId }), "structure.preset_edit");
}
export async function createCsvDryRun(batchId: string, boardId: string, rows: readonly unknown[], requestId: string) {
  if (![batchId, boardId, requestId].every((id) => UUID.test(id))) return { ok: false, message: "서버에서 불러온 보드와 요청 식별자가 필요합니다." };
  return invoke("create_workspace_csv_dry_run", (orgId) => ({ p_batch_id: batchId, p_org_id: orgId, p_board_id: boardId, p_rows: rows, p_request_id: requestId }), "danger.data_import", batchId);
}
export async function applyCsv(batchId: string) { return UUID.test(batchId) ? invoke("apply_workspace_csv_batch", () => ({ p_batch_id: batchId }), "danger.data_import", batchId, "danger.data_import") : { ok: false, message: "CSV dry-run을 먼저 만드세요." }; }
export async function rollbackCsv(batchId: string) { return UUID.test(batchId) ? invoke("rollback_workspace_csv_batch", () => ({ p_batch_id: batchId }), "danger.data_import", batchId, "danger.data_import") : { ok: false, message: "적용된 CSV가 없습니다." }; }
export async function saveAutomationDraft(automationId: string, boardId: string, draft: Record<string, unknown>, requestId: string) {
  if (![automationId, boardId, requestId].every((id) => UUID.test(id))) return { ok: false, message: "서버에서 불러온 보드와 요청 식별자가 필요합니다." };
  return invoke("save_workspace_automation_draft", (orgId) => ({ p_automation_id: automationId, p_org_id: orgId, p_board_id: boardId, p_draft: draft, p_request_id: requestId }), "automation.edit", automationId);
}
export async function activateAutomation(automationId: string) { return UUID.test(automationId) ? invoke("activate_workspace_automation", () => ({ p_automation_id: automationId }), "automation.edit", automationId) : { ok: false, message: "자동화 초안을 먼저 저장해 주세요." }; }
