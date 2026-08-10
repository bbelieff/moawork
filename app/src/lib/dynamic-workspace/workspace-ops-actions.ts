"use server";

import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type WorkspaceOpsAction = Readonly<{ ok: boolean; message: string; id?: string }>;
type RpcClient = { rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function invoke(name: string, params: (orgId: string) => Record<string, unknown>, id?: string): Promise<WorkspaceOpsAction> {
  const ctx = await getSession();
  if (ctx.role !== "owner") return { ok: false, message: "대표 권한을 확인할 수 없습니다." };
  const client = await createClient() as unknown as RpcClient;
  const result = await client.rpc(name, params(ctx.org.id));
  const value = result.data as { accepted?: unknown } | null;
  return !result.error && value?.accepted === true ? { ok: true, message: "서버 요청을 완료했습니다.", id } : { ok: false, message: "서버 요청을 완료하지 못했습니다. 다시 시도해 주세요." };
}

export async function saveBuilder(configuration: Record<string, unknown>, requestId: string) {
  if (!UUID.test(requestId)) return { ok: false, message: "요청 식별자가 올바르지 않습니다." };
  return invoke("save_workspace_builder_config", (orgId) => ({ p_org_id: orgId, p_configuration: configuration, p_request_id: requestId }));
}
export async function createCsvDryRun(batchId: string, boardId: string, rows: readonly unknown[], requestId: string) {
  if (![batchId, boardId, requestId].every((id) => UUID.test(id))) return { ok: false, message: "서버에서 불러온 보드와 요청 식별자가 필요합니다." };
  return invoke("create_workspace_csv_dry_run", (orgId) => ({ p_batch_id: batchId, p_org_id: orgId, p_board_id: boardId, p_rows: rows, p_request_id: requestId }), batchId);
}
export async function applyCsv(batchId: string) { return UUID.test(batchId) ? invoke("apply_workspace_csv_batch", () => ({ p_batch_id: batchId }), batchId) : { ok: false, message: "CSV dry-run을 먼저 만드세요." }; }
export async function rollbackCsv(batchId: string) { return UUID.test(batchId) ? invoke("rollback_workspace_csv_batch", () => ({ p_batch_id: batchId }), batchId) : { ok: false, message: "적용된 CSV가 없습니다." }; }
export async function saveAutomationDraft(automationId: string, boardId: string, draft: Record<string, unknown>, requestId: string) {
  if (![automationId, boardId, requestId].every((id) => UUID.test(id))) return { ok: false, message: "서버에서 불러온 보드와 요청 식별자가 필요합니다." };
  return invoke("save_workspace_automation_draft", (orgId) => ({ p_automation_id: automationId, p_org_id: orgId, p_board_id: boardId, p_draft: draft, p_request_id: requestId }), automationId);
}
export async function activateAutomation(automationId: string) { return UUID.test(automationId) ? invoke("activate_workspace_automation", () => ({ p_automation_id: automationId }), automationId) : { ok: false, message: "자동화 초안을 먼저 저장해 주세요." }; }
