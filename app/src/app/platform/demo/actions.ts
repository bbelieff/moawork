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
  const { state, selectedOrgId } = await loadPlatformDemoTabContext();
  if (
    state.kind !== "ready" ||
    state.tenantAccess !== "active-membership" ||
    selectedOrgId === null
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
