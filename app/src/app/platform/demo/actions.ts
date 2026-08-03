"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAccess } from "@/lib/platform/guard";
import {
  resolveAdminModeWorkspaceSelection,
  resolveInternalDemoOptions,
} from "@/lib/release-rings/resolve";
import { loadPlatformDemoTabContext } from "@/lib/platform/demo";
import { createClient } from "@/lib/supabase/server";
import { getSessionOrNull } from "@/lib/auth/session";
import { AsyncCrmService } from "@/lib/crm/asyncService";
import { getStageBoard } from "@/lib/crm/stageBoards";
import type { CsvRow } from "@/components/workspace-builder/CsvImportDialog";

type WorkspaceOpsAction = Readonly<{ ok: boolean; message: string; id?: string }>;
type RpcClient = {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function selectedDemoMutationContext(): Promise<{
  client: RpcClient;
  orgId: string;
} | null> {
  await requirePlatformAccess("/platform/demo");
  const [{ state, selectedOrgId }, session] = await Promise.all([loadPlatformDemoTabContext(), getSessionOrNull()]);
  if (
    state.kind !== "ready" ||
    state.tenantAccess !== "active-membership" ||
    !state.selectedWorkspaceIsCurrent ||
    selectedOrgId === null ||
    session?.org.id !== selectedOrgId
  ) return null;
  return {
    client: await createClient() as unknown as RpcClient,
    orgId: selectedOrgId,
  };
}

function workspaceOpsResult(
  result: { data: unknown; error: unknown },
  id?: string,
): WorkspaceOpsAction {
  const value = result.data as { accepted?: unknown } | null;
  return !result.error && value?.accepted === true
    ? { ok: true, message: "서버 요청을 완료했습니다.", id }
    : { ok: false, message: "서버 요청을 완료하지 못했습니다. 다시 시도해 주세요." };
}

function unavailable(): never {
  redirect("/platform/demo?error=unavailable");
}

/**
 * Selects an option by its server-verified list position. No workspace id or
 * slug is accepted from the browser, and the RPC rechecks current authority.
 */
export async function selectPlatformDemoWorkspace(formData: FormData) {
  await requirePlatformAccess("/platform/demo");

  const rawIndex = formData.get("demoIndex");
  const index = typeof rawIndex === "string" ? Number(rawIndex) : Number.NaN;
  if (!Number.isInteger(index) || index < 0) unavailable();

  const supabase = await createClient();
  const discoveredResult = await supabase.rpc(
    "list_reviewed_internal_demo_release_options",
  );
  if (discoveredResult.error) unavailable();

  const discovered = resolveInternalDemoOptions(discoveredResult.data);
  if (discovered.kind !== "ready" || index >= discovered.options.length) {
    unavailable();
  }

  const option = discovered.options[index];
  const selectionResult = await supabase.rpc(
    "platform_set_admin_mode_workspace_selection",
    {
      p_request_id: crypto.randomUUID(),
      p_org_id: option.orgId,
    },
  );
  if (selectionResult.error) unavailable();

  revalidatePath("/platform/demo");
  redirect("/platform/demo");
}

/** Creates the selected demo's initial DB board without accepting an org id. */
export async function preparePlatformDemoWorkspace(formData: FormData) {
  await requirePlatformAccess("/platform/demo");

  const rawIndex = formData.get("demoIndex");
  const index = typeof rawIndex === "string" ? Number(rawIndex) : Number.NaN;
  if (!Number.isInteger(index) || index < 0) unavailable();

  const supabase = await createClient();
  const [discoveredResult, selectionResult] = await Promise.all([
    supabase.rpc("list_reviewed_internal_demo_release_options"),
    supabase.rpc("get_my_admin_mode_workspace_selection"),
  ]);
  if (discoveredResult.error || selectionResult.error) unavailable();

  const discovered = resolveInternalDemoOptions(discoveredResult.data);
  const selection = resolveAdminModeWorkspaceSelection(selectionResult.data);
  if (
    discovered.kind !== "ready" ||
    index >= discovered.options.length ||
    selection.kind !== "ready" ||
    selection.routeAuthorization !== "active_membership"
  ) unavailable();

  const option = discovered.options[index];
  if (option.orgId !== selection.orgId || option.routePath !== selection.routePath) {
    unavailable();
  }

  const result = await supabase.rpc(
    "platform_ensure_selected_demo_workspace",
    { p_request_id: crypto.randomUUID(), p_org_id: option.orgId },
  );
  if (result.error) unavailable();

  revalidatePath("/platform/demo");
  redirect("/platform/demo");
}

/** Persists builder state to the server-selected demo; the browser never sends an org id. */
export async function savePlatformDemoBuilder(
  configuration: Record<string, unknown>,
  requestId: string,
): Promise<WorkspaceOpsAction> {
  if (!UUID.test(requestId)) {
    return { ok: false, message: "요청 식별자가 올바르지 않습니다." };
  }
  const context = await selectedDemoMutationContext();
  if (!context) {
    return { ok: false, message: "데모 워크스페이스 접근 권한을 확인할 수 없습니다." };
  }
  return workspaceOpsResult(await context.client.rpc(
    "save_workspace_builder_config",
    {
      p_org_id: context.orgId,
      p_configuration: configuration,
      p_request_id: requestId,
    },
  ));
}

/** Creates a dry-run inside the server-selected demo without exposing its org id. */
export async function createPlatformDemoCsvDryRun(
  batchId: string,
  boardId: string,
  rows: readonly unknown[],
  requestId: string,
): Promise<WorkspaceOpsAction> {
  if (![batchId, boardId, requestId].every((id) => UUID.test(id))) {
    return { ok: false, message: "서버에서 불러온 보드와 요청 식별자가 필요합니다." };
  }
  const context = await selectedDemoMutationContext();
  if (!context) {
    return { ok: false, message: "데모 워크스페이스 접근 권한을 확인할 수 없습니다." };
  }
  return workspaceOpsResult(await context.client.rpc(
    "create_workspace_csv_dry_run",
    {
      p_batch_id: batchId,
      p_org_id: context.orgId,
      p_board_id: boardId,
      p_rows: rows,
      p_request_id: requestId,
    },
  ), batchId);
}

/** Imports synthetic CSV rows into the CRM model currently rendered by the demo. */
export async function importPlatformDemoCrmCsv(boardSlug: string, rows: readonly CsvRow[]): Promise<WorkspaceOpsAction> {
  const board = getStageBoard(boardSlug);
  const safeRows = Array.isArray(rows) && rows.length <= 500 && rows.every((row) => {
    if (!row || typeof row !== "object" || typeof row.title !== "string" || !row.title.trim() || row.title.length > 200 || !row.values || typeof row.values !== "object" || Array.isArray(row.values)) return false;
    const entries = Object.entries(row.values);
    return entries.length <= 50 && entries.every(([key, value]) => key.length > 0 && key.length <= 80 && !["__proto__", "constructor", "prototype"].includes(key) && typeof value === "string" && value.length <= 2000);
  });
  const payloadBytes = safeRows ? new TextEncoder().encode(JSON.stringify(rows)).byteLength : Number.POSITIVE_INFINITY;
  if (!board || rows.length === 0 || !safeRows || payloadBytes > 1024 * 1024) {
    return { ok: false, message: "CSV 형식이나 행 수를 확인해 주세요. 한 번에 최대 500개까지 가져올 수 있어요." };
  }
  const context = await selectedDemoMutationContext();
  const session = await getSessionOrNull();
  if (!context || !session || session.org.id !== context.orgId) return { ok: false, message: "데모 워크스페이스 접근 권한을 확인할 수 없어요." };
  const service = new AsyncCrmService();
  const pipelines = await service.listPipelines(session);
  const stage = pipelines.flatMap((pipeline) => pipeline.stages).filter((candidate) => candidate.kind === board.kind).sort((a, b) => a.sort_order - b.sort_order)[0];
  if (!stage) return { ok: false, message: "선택한 CRM 보드의 첫 단계를 찾을 수 없어요." };
  const client = await createClient();
  const { error } = await client.from("deals").insert(rows.map((row) => ({
    org_id: context.orgId,
    title: row.title.trim(),
    pipeline_id: stage.pipeline_id,
    stage_id: stage.id,
    assigned_to: session.user.id,
    custom: row.values,
  })));
  if (error) return { ok: false, message: "CSV를 저장하지 못했어요. 어떤 행도 추가되지 않았습니다." };
  revalidatePath("/platform/demo");
  return { ok: true, message: `${rows.length}개 항목을 ${board.title} 보드에 가져왔어요.` };
}
