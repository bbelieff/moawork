import { createClient } from "@/lib/supabase/server";
import type { WorkspaceRequestInput, WorkspaceRequestResult } from "./contracts";
import type { WorkspaceEntryOption } from "@/lib/auth/workspace-entry-server";
import { isCanonicalWorkspaceSlug } from "@/lib/auth/workspace-routing";

type RpcResult = { data: unknown; error: { code?: string } | null };

export type WorkspaceEntryRpcClient = {
  rpc(name: string, params?: Record<string, unknown>): Promise<RpcResult>;
};

export type MyWorkspaceEntryRequest = {
  requestId: string;
  kind: "create" | "join";
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
  resolvedAt: string | null;
  decisionState: "pending" | "approved" | "not_approved" | "cancelled";
  approvedTargetSlug: string | null;
  reviewDeadline: string | null;
};

export type PlatformCreateRequest = {
  requestId: string;
  desiredName: string;
  desiredSlug: string;
  createdAt: string;
};

export type OwnerJoinRequest = {
  requestId: string;
  requesterUserId: string;
  createdAt: string;
};

export type WorkspaceEntryContext =
  | { kind: "error" }
  | {
      kind: "ready";
      isPlatformAdmin: boolean;
      requests: MyWorkspaceEntryRequest[];
      platformCreateRequests: PlatformCreateRequest[];
      ownerJoinRequests: OwnerJoinRequest[];
    };

export type ApprovedRequestTarget =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "workspace"; slug: string };

export function decideApprovedRequestTarget(
  requests: MyWorkspaceEntryRequest[],
  memberships: WorkspaceEntryOption[],
  resumeRequestId?: string,
): ApprovedRequestTarget {
  if (!resumeRequestId) return { kind: "none" };
  const candidates = requests.filter((request) => request.requestId === resumeRequestId && (request.decisionState === "approved" || request.status === "approved" || request.approvedTargetSlug !== null));
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length !== 1) return { kind: "invalid" };
  for (const request of candidates) {
    const created = Date.parse(request.createdAt);
    const resolved = request.resolvedAt ? Date.parse(request.resolvedAt) : Number.NaN;
    if (request.status !== "approved" || request.decisionState !== "approved" || !request.approvedTargetSlug || !isCanonicalWorkspaceSlug(request.approvedTargetSlug) || !Number.isFinite(created) || !Number.isFinite(resolved) || resolved < created) return { kind: "invalid" };
  }
  const approved = candidates.sort((a, b) => Date.parse(b.resolvedAt!) - Date.parse(a.resolvedAt!) || b.requestId.localeCompare(a.requestId));
  const matches = memberships.filter((membership) => membership.slug === approved[0].approvedTargetSlug);
  return matches.length === 1 ? { kind: "workspace", slug: matches[0].slug } : { kind: "invalid" };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : text(row, key);
}

function rows(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(record);
  return parsed.every((row): row is Record<string, unknown> => row !== null) ? parsed : null;
}

function parseMyRequests(value: unknown): MyWorkspaceEntryRequest[] | null {
  const source = rows(value);
  if (!source) return null;
  const result: MyWorkspaceEntryRequest[] = [];
  for (const row of source) {
    const requestId = text(row, "request_id");
    const kind = text(row, "entry_kind");
    const status = text(row, "request_status");
    const createdAt = text(row, "created_at");
    const decisionState = text(row, "decision_state");
    if (
      !requestId || !createdAt ||
      (kind !== "create" && kind !== "join") ||
      (status !== "pending" && status !== "approved" && status !== "rejected" && status !== "cancelled") ||
      (decisionState !== "pending" && decisionState !== "approved" && decisionState !== "not_approved" && decisionState !== "cancelled")
    ) return null;
    result.push({
      requestId,
      kind,
      status,
      createdAt,
      resolvedAt: nullableText(row, "resolved_at"),
      decisionState,
      approvedTargetSlug: nullableText(row, "approved_target_slug"),
      reviewDeadline: nullableText(row, "review_deadline"),
    });
  }
  return result;
}

function parsePlatformQueue(value: unknown): PlatformCreateRequest[] | null {
  const source = rows(value);
  if (!source) return null;
  const result: PlatformCreateRequest[] = [];
  for (const row of source) {
    const requestId = text(row, "request_id");
    const desiredName = text(row, "desired_name");
    const desiredSlug = text(row, "desired_slug");
    const createdAt = text(row, "created_at");
    if (!requestId || !desiredName || !desiredSlug || !createdAt) return null;
    result.push({ requestId, desiredName, desiredSlug, createdAt });
  }
  return result;
}

function parseOwnerQueue(value: unknown): OwnerJoinRequest[] | null {
  const source = rows(value);
  if (!source) return null;
  const result: OwnerJoinRequest[] = [];
  for (const row of source) {
    const requestId = text(row, "request_id");
    const requesterUserId = text(row, "requester_user_id");
    const createdAt = text(row, "created_at");
    if (!requestId || !requesterUserId || !createdAt) return null;
    result.push({ requestId, requesterUserId, createdAt });
  }
  return result;
}

export async function readWorkspaceEntryContext(
  client: WorkspaceEntryRpcClient,
  ownerOrgId?: string,
): Promise<WorkspaceEntryContext> {
  const [platformResult, requestsResult] = await Promise.all([
    client.rpc("is_platform_admin"),
    client.rpc("list_my_workspace_entry_requests"),
  ]);
  if (platformResult.error || requestsResult.error) return { kind: "error" };
  const isPlatformAdmin = platformResult.data === true;
  const requests = parseMyRequests(requestsResult.data);
  if (!requests) return { kind: "error" };

  let platformCreateRequests: PlatformCreateRequest[] = [];
  if (isPlatformAdmin) {
    const result = await client.rpc("list_pending_workspace_create_requests");
    if (result.error) return { kind: "error" };
    const parsed = parsePlatformQueue(result.data);
    if (!parsed) return { kind: "error" };
    platformCreateRequests = parsed;
  }

  let ownerJoinRequests: OwnerJoinRequest[] = [];
  if (ownerOrgId) {
    const result = await client.rpc("list_pending_workspace_join_requests", { p_org_id: ownerOrgId });
    if (result.error) return { kind: "error" };
    const parsed = parseOwnerQueue(result.data);
    if (!parsed) return { kind: "error" };
    ownerJoinRequests = parsed;
  }

  return { kind: "ready", isPlatformAdmin, requests, platformCreateRequests, ownerJoinRequests };
}

export async function loadWorkspaceEntryContext(ownerOrgId?: string): Promise<WorkspaceEntryContext> {
  return readWorkspaceEntryContext(await createClient() as unknown as WorkspaceEntryRpcClient, ownerOrgId);
}

export async function executeWorkspaceRequest(
  client: WorkspaceEntryRpcClient,
  input: WorkspaceRequestInput,
): Promise<{ result: WorkspaceRequestResult; status: number }> {
  let rpc: Promise<RpcResult>;
  if (input.kind === "create") {
    rpc = client.rpc("submit_workspace_create_request", {
      p_request_id: input.requestId,
      p_name: input.displayName,
      p_slug: input.slug,
    });
  } else if (input.kind === "join") {
    rpc = client.rpc("submit_workspace_join_request", { p_request_id: input.requestId, p_lookup: input.lookup });
  } else if (input.kind === "cancel") {
    rpc = client.rpc("cancel_workspace_entry_request", { p_request_id: input.requestId });
  } else if (input.kind === "resolve_create") {
    rpc = client.rpc("resolve_workspace_create_request", {
      p_request_id: input.requestId,
      p_approve: input.approve,
      p_decision_code: input.approve ? "approved_by_platform" : "rejected_by_platform",
    });
  } else if (input.kind === "resolve_join") {
    rpc = client.rpc("resolve_workspace_join_request", {
      p_request_id: input.requestId,
      p_approve: input.approve,
      p_decision_code: input.approve ? "approved_by_owner" : "rejected_by_owner",
    });
  } else {
    return { result: { ok: false, state: "invalid", message: "요청을 확인할 수 없어요." }, status: 400 };
  }

  const response = await rpc;
  if (response.error) {
    return {
      result: { ok: false, state: "unavailable", message: "요청을 지금 처리할 수 없어요. 목록을 새로 확인한 뒤 다시 시도해 주세요." },
      status: 409,
    };
  }

  const state = input.kind === "cancel"
    ? "cancelled"
    : input.kind === "resolve_create" || input.kind === "resolve_join"
      ? input.approve ? "approved" : "rejected"
      : "pending";
  const message = state === "pending"
    ? "요청을 보냈어요. 승인 전에는 회사에 들어갈 수 없어요."
    : state === "cancelled"
      ? "요청을 취소했어요. 새 요청은 언제든 다시 보낼 수 있어요."
      : state === "approved"
        ? "승인했어요. 현재 멤버십을 다시 확인해 안전하게 반영할게요."
        : "승인하지 않았어요. 요청자에게는 회사 정보 없이 결과만 보여요.";
  return { result: { ok: true, state, message }, status: 200 };
}
