import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

export type WorkspaceBoard = Readonly<{ id: string; name: string; description: string | null; icon: string | null }>;
export type WorkspaceAutomation = Readonly<{ id: string; boardId: string; draft: Record<string, unknown>; state: "draft" | "active" | "quarantined" }>;
export type WorkspaceOpsSnapshot = Readonly<{
  boards: readonly WorkspaceBoard[];
  builder: Readonly<{ configuration: Record<string, unknown>; version: number }> | null;
  automations: readonly WorkspaceAutomation[];
  readError: string | null;
}>;

type RpcResult<T> = Readonly<{ data: T | null; error: unknown }>;
type RpcClient = { rpc<T>(name: string, params: Record<string, unknown>): Promise<RpcResult<T>> };

function safeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function message(error: unknown): string {
  return error ? "서버 상태를 불러오지 못했습니다. 다시 시도해 주세요." : "";
}

function malformed(): WorkspaceOpsSnapshot {
  return { boards: [], builder: null, automations: [], readError: "서버 응답 형식이 올바르지 않습니다." };
}

function isWorkspaceBoard(value: WorkspaceBoard | null): value is WorkspaceBoard {
  return value !== null;
}

function isWorkspaceAutomation(value: WorkspaceAutomation | null): value is WorkspaceAutomation {
  return value !== null;
}

/** Server-only: every RPC independently requires the caller to own this org. */
export async function loadOwnerWorkspaceOpsSnapshotForOrg(orgId: string): Promise<WorkspaceOpsSnapshot> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(orgId)) {
    return { boards: [], builder: null, automations: [], readError: "대표 권한이 필요합니다." };
  }
  const client = await createClient() as unknown as RpcClient;
  const args = { p_org_id: orgId };
  const [boardsResult, builderResult, automationsResult] = await Promise.all([
    client.rpc<unknown[]>("list_workspace_ops_boards", args),
    client.rpc<unknown[]>("get_workspace_builder_config", args),
    client.rpc<unknown[]>("list_workspace_automation_configs", args),
  ]);
  if (boardsResult.error || builderResult.error || automationsResult.error) {
    return { boards: [], builder: null, automations: [], readError: message(boardsResult.error ?? builderResult.error ?? automationsResult.error) };
  }
  const boardRows = boardsResult.data ?? [];
  const boards = boardRows.map((row) => {
    const item = safeObject(row); const id = item?.board_id; const name = item?.name;
    const description = item?.description; const icon = item?.icon;
    const descriptionIsValid = description === null || typeof description === "string";
    const iconIsValid = icon === null || typeof icon === "string";
    return typeof id === "string" && typeof name === "string" && descriptionIsValid && iconIsValid
      ? { id, name, description: description === null ? null : description, icon: icon === null ? null : icon }
      : null;
  });
  const completeBoards = boards.filter(isWorkspaceBoard);
  if (completeBoards.length !== boards.length) return malformed();
  const builderRows = builderResult.data ?? [];
  if (builderRows.length > 1) return malformed();
  const builderRow = safeObject(builderRows[0]);
  const configuration = safeObject(builderRow?.configuration);
  if (builderRows.length === 1 && (!configuration || typeof builderRow?.version !== "number")) return malformed();
  const builder = configuration && typeof builderRow?.version === "number" ? { configuration, version: builderRow.version } : null;
  const automationRows = automationsResult.data ?? [];
  const automations = automationRows.map((row) => {
    const item = safeObject(row); const id = item?.automation_id; const boardId = item?.board_id; const draft = safeObject(item?.draft); const state = item?.state;
    const safeState: WorkspaceAutomation["state"] | null = state === "draft" || state === "active" || state === "quarantined" ? state : null;
    return typeof id === "string" && typeof boardId === "string" && draft && safeState ? { id, boardId, draft, state: safeState } : null;
  });
  const completeAutomations = automations.filter(isWorkspaceAutomation);
  if (completeAutomations.length !== automations.length) return malformed();
  return { boards: completeBoards, builder, automations: completeAutomations, readError: null };
}

export async function loadOwnerWorkspaceOpsSnapshot(): Promise<WorkspaceOpsSnapshot> {
  const ctx = await getSession();
  if (ctx.role !== "owner") return { boards: [], builder: null, automations: [], readError: "대표 권한이 필요합니다." };
  return loadOwnerWorkspaceOpsSnapshotForOrg(ctx.org.id);
}
