import type { SupabaseClient } from "@supabase/supabase-js";

type DbError = {
  message: string;
  code?: string;
};

export type WorkspaceBootstrapResult = {
  orgId: string;
  pipelineId: string;
  entitlementsCreated: number;
  stagesCreated: number;
};

export class WorkspaceOperationError extends Error {
  constructor(
    readonly operation: "bootstrap" | "rename",
    readonly code: string,
    cause?: unknown,
  ) {
    super(
      operation === "bootstrap"
        ? "워크스페이스 기본 구성을 준비하지 못했습니다."
        : "워크스페이스 이름을 저장하지 못했습니다.",
      { cause },
    );
    this.name = "WorkspaceOperationError";
  }
}

function errorCode(error: DbError | null): string {
  return error?.code ?? "workspace_error";
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function parseBootstrapResult(value: unknown): WorkspaceBootstrapResult | null {
  const row = record(value);
  if (!row) return null;
  const orgId = row.org_id;
  const pipelineId = row.pipeline_id;
  const entitlementsCreated = integer(row.entitlements_created);
  const stagesCreated = integer(row.stages_created);
  if (
    typeof orgId !== "string" ||
    typeof pipelineId !== "string" ||
    entitlementsCreated === null ||
    stagesCreated === null
  ) {
    return null;
  }
  return { orgId, pipelineId, entitlementsCreated, stagesCreated };
}

export function normalizeWorkspaceName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80) {
    throw new WorkspaceOperationError("rename", "invalid_name");
  }
  return name;
}

export async function bootstrapWorkspace(
  supabase: SupabaseClient,
  orgId: string,
): Promise<WorkspaceBootstrapResult> {
  const { data, error } = await supabase.rpc("bootstrap_workspace", {
    p_org_id: orgId,
  });
  if (error) {
    throw new WorkspaceOperationError(
      "bootstrap",
      errorCode(error),
      error,
    );
  }
  const result = parseBootstrapResult(data);
  if (!result || result.orgId !== orgId) {
    throw new WorkspaceOperationError("bootstrap", "invalid_response");
  }
  return result;
}

export async function renameWorkspace(
  supabase: SupabaseClient,
  orgId: string,
  rawName: unknown,
): Promise<string> {
  const name = normalizeWorkspaceName(rawName);
  const { data, error } = await supabase
    .from("orgs")
    .update({ name })
    .eq("id", orgId)
    .select("id, name")
    .single();

  if (error) {
    throw new WorkspaceOperationError("rename", errorCode(error), error);
  }
  const row = record(data);
  if (row?.id !== orgId || row.name !== name) {
    throw new WorkspaceOperationError("rename", "invalid_response");
  }
  return name;
}
