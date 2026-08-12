import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { WorkspaceRequestInput, WorkspaceRequestResult } from "./contracts";
import type { WorkspaceEntryOption } from "@/lib/auth/workspace-entry-server";
import { isCanonicalWorkspaceSlug } from "@/lib/auth/workspace-routing";
import { parseAdminRole } from "@/lib/auth/admin";

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

export type WorkspaceApprovals = {
  pendingCount: number;
};

export type WorkspaceEntryContext =
  | { kind: "error" }
  | {
      kind: "ready";
      isPlatformAdmin: boolean;
      requests: MyWorkspaceEntryRequest[];
      platformCreateRequests: PlatformCreateRequest[];
      ownerJoinRequests: OwnerJoinRequest[];
      ownerPendingApprovalCount: number;
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

function parsePendingApprovalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function readWorkspaceApprovals(
  client: WorkspaceEntryRpcClient,
  ownerOrgId?: string,
): Promise<WorkspaceApprovals> {
  if (!ownerOrgId) return { pendingCount: 0 };
  const result = await client.rpc("count_pending_workspace_join_requests", { p_org_id: ownerOrgId });
  const pendingCount = result.error ? null : parsePendingApprovalCount(result.data);
  return { pendingCount: pendingCount ?? 0 };
}

export async function loadWorkspaceApprovals(ownerOrgId?: string): Promise<WorkspaceApprovals> {
  // Supabase 미설정(로컬 dev)에서는 승인 대기 건수를 «셀 수 없다» — 0 건과 같은 화면이다.
  // 던지면 (app) 레이아웃 전체가 500 이 된다. readWorkspaceApprovals 가 ownerOrgId 없을 때
  // 돌려주는 값과 같은 모양을 쓴다.
  if (!hasSupabaseEnv()) return { pendingCount: 0 };
  return readWorkspaceApprovals(await createClient() as unknown as WorkspaceEntryRpcClient, ownerOrgId);
}

function parseRequestStatus(value: unknown, pendingFallback: boolean): "pending" | "expired" | "cancelled" | "approved" | "rejected" | null {
  const row = record(value);
  if (!row || row.accepted !== true) return null;
  const status = row.status;
  if (status === undefined && pendingFallback) return "pending";
  return status === "pending" || status === "expired" || status === "cancelled" || status === "approved" || status === "rejected"
    ? status
    : null;
}

export async function readWorkspaceEntryContext(
  client: WorkspaceEntryRpcClient,
  ownerOrgId?: string,
  /** 로그인 사용자 이메일. is_platform_admin() 이 false 일 때 폴백 판정에 쓴다. */
  actorEmail?: string | null,
): Promise<WorkspaceEntryContext> {
  const [platformResult, requestsResult] = await Promise.all([
    client.rpc("is_platform_admin"),
    client.rpc("list_my_workspace_entry_requests"),
  ]);
  if (platformResult.error || requestsResult.error) return { kind: "error" };
  let isPlatformAdmin = platformResult.data === true;

  // ── 폴백: is_platform_admin() 이 false 를 준 경우 app_admin_role 로 한 번 더 본다 ──
  // 왜 필요한가: 배포된 is_platform_admin()(006)은 `app_admins.role = 'admin'` 을 요구하는데
  // 005 는 예약 관리자를 role='owner' 로 넣는다. 그래서 실제 관리자가 false 로 나온다.
  // 017 이 그 함수를 고치지만, **마이그레이션 적용 전에도** 관리자가 갇히지 않아야 한다.
  // app_admin_role(email) 은 role 필터가 없어 지금도 정상 동작하고, main 의
  // 014_platform_metrics_daily 도 이미 `app_admin_role(...) is not null` 패턴을 쓴다.
  // 017 적용 후에는 위 판정이 곧바로 true 라 이 블록은 자연히 no-op 이 된다.
  // 방향은 한쪽뿐이다 — false→true 승격만 하고, true 를 뒤집지는 않는다.
  if (!isPlatformAdmin && actorEmail) {
    try {
      const fallback = await client.rpc("app_admin_role", { p_email: actorEmail });
      if (fallback && !fallback.error && parseAdminRole(fallback.data) !== null) {
        isPlatformAdmin = true;
      }
    } catch {
      // 폴백 실패는 무시 — 판정 불가는 "관리자 아님"으로 남긴다.
    }
  }
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
  let ownerPendingApprovalCount = 0;
  if (ownerOrgId) {
    const [result, countResult] = await Promise.all([
      client.rpc("list_pending_workspace_join_requests", { p_org_id: ownerOrgId }),
      client.rpc("count_pending_workspace_join_requests", { p_org_id: ownerOrgId }),
    ]);
    if (result.error || countResult.error) return { kind: "error" };
    const parsed = parseOwnerQueue(result.data);
    const parsedCount = parsePendingApprovalCount(countResult.data);
    if (!parsed || parsedCount === null || parsed.length !== parsedCount) return { kind: "error" };
    ownerJoinRequests = parsed;
    ownerPendingApprovalCount = parsedCount;
  }

  return { kind: "ready", isPlatformAdmin, requests, platformCreateRequests, ownerJoinRequests, ownerPendingApprovalCount };
}

export async function loadWorkspaceEntryContext(ownerOrgId?: string): Promise<WorkspaceEntryContext> {
  // 위와 같은 이유. «조회 불가» 는 이미 있는 error 종류로 표현한다 — 호출부가 ready 만 소비한다.
  if (!hasSupabaseEnv()) return { kind: "error" };
  const supabase = await createClient();
  // 폴백 판정용 이메일. 실패해도 진행한다 — 이메일이 없으면 폴백만 건너뛴다.
  let actorEmail: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    actorEmail = data?.user?.email ?? null;
  } catch {
    actorEmail = null;
  }
  return readWorkspaceEntryContext(
    supabase as unknown as WorkspaceEntryRpcClient,
    ownerOrgId,
    actorEmail,
  );
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

  const state = parseRequestStatus(response.data, input.kind === "create" || input.kind === "join");
  if (!state) {
    return {
      result: { ok: false, state: "unavailable", message: "요청을 지금 처리할 수 없어요. 목록을 새로 확인한 뒤 다시 시도해 주세요." },
      status: 409,
    };
  }
  const message = state === "pending"
    ? "요청을 보냈어요. 승인 전에는 회사에 들어갈 수 없어요."
    : state === "expired"
      ? "요청 기간이 끝났어요. 필요하면 새 요청을 보낼 수 있어요."
    : state === "cancelled"
      ? "요청을 취소했어요. 새 요청은 언제든 다시 보낼 수 있어요."
      : state === "approved"
        ? "승인했어요. 현재 멤버십을 다시 확인해 안전하게 반영할게요."
        : "승인하지 않았어요. 요청자에게는 회사 정보 없이 결과만 보여요.";

  // 플랫폼 관리자의 회사 만들기는 승인 절차 없이 즉시 생성된다(018).
  // 그 경우 RPC 가 auto_approved + slug 를 돌려주므로 바로 새 회사로 보낸다 —
  // 이 배선이 없으면 이미 만들어진 회사를 두고 "승인 대기" 화면에 머문다.
  if (input.kind === "create" && state === "approved") {
    const row = record(response.data);
    const slug = row?.auto_approved === true && typeof row.slug === "string" ? row.slug : null;
    if (slug) {
      return {
        result: {
          ok: true,
          state,
          message: "회사를 만들었어요. 바로 들어갈게요.",
          redirectTo: `/w/${slug}`,
        },
        status: 200,
      };
    }
  }

  return { result: { ok: true, state, message }, status: 200 };
}
