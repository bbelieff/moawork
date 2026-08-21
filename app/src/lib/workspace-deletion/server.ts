import { createClient } from "@/lib/supabase/server";

export type OwnerWorkspaceDeletionRow = {
  orgId: string;
  name: string;
  slug: string;
  status: "active" | "pending_delete";
  role: "owner";
  deletionRequestedAt: string | null;
};

type RpcResult = { data: unknown; error: unknown };
export type WorkspaceDeletionRpcClient = {
  rpc(name: string, params?: Record<string, unknown>): Promise<RpcResult>;
};

export class WorkspaceDeletionUnavailableError extends Error {
  constructor() {
    super("workspace_deletion_unavailable");
  }
}

function parseRows(value: unknown): OwnerWorkspaceDeletionRow[] | null {
  if (!Array.isArray(value)) return null;
  const result: OwnerWorkspaceDeletionRow[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const row = candidate as Record<string, unknown>;
    const orgId = typeof row.org_id === "string" ? row.org_id : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const slug = typeof row.slug === "string" ? row.slug : "";
    const requestedAt = row.deletion_requested_at;
    if (
      !orgId || !name || !slug || seen.has(orgId) || row.role !== "owner" ||
      (row.status !== "active" && row.status !== "pending_delete") ||
      (requestedAt !== null && typeof requestedAt !== "string")
    ) return null;
    seen.add(orgId);
    result.push({
      orgId,
      name,
      slug,
      status: row.status,
      role: "owner",
      deletionRequestedAt: requestedAt,
    });
  }
  return result;
}

export async function readOwnerWorkspaceDeletionRows(client: WorkspaceDeletionRpcClient) {
  const result = await client.rpc("list_my_workspaces");
  const rows = result.error ? null : parseRows(result.data);
  if (!rows) throw new WorkspaceDeletionUnavailableError();
  return rows;
}

export async function loadOwnerWorkspaceDeletionRows() {
  return readOwnerWorkspaceDeletionRows(await createClient() as unknown as WorkspaceDeletionRpcClient);
}

async function mutate(name: string, params: Record<string, unknown>, expected: string) {
  const client = await createClient();
  const result = await client.rpc(name, params);
  if (result.error || result.data !== expected) throw new WorkspaceDeletionUnavailableError();
}

export async function requestWorkspaceDeletion(orgId: string, confirmation: string) {
  await mutate("request_workspace_deletion", { p_org_id: orgId, p_confirmation: confirmation }, "pending_delete");
}

export async function restoreWorkspaceDeletion(orgId: string) {
  await mutate("restore_workspace_deletion", { p_org_id: orgId }, "active");
}
