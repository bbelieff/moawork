import { describe, expect, it, vi } from "vitest";
import { decideApprovedRequestTarget, executeWorkspaceRequest, readWorkspaceApprovals, readWorkspaceEntryContext, type WorkspaceEntryRpcClient } from "./server";

function client(results: Record<string, { data: unknown; error: { code?: string } | null }>): WorkspaceEntryRpcClient {
  return { rpc: vi.fn(async (name: string) => results[name] ?? { data: null, error: { code: "missing" } }) };
}

describe("workspace entry RPC adapter", () => {
  it("exposes only a protected-owner approval aggregate and fails closed for every other context", async () => {
    const owner = client({ count_pending_workspace_join_requests: { data: 2, error: null } });
    await expect(readWorkspaceApprovals(owner, "org-1")).resolves.toEqual({ pendingCount: 2 });
    expect(owner.rpc).toHaveBeenCalledWith("count_pending_workspace_join_requests", { p_org_id: "org-1" });

    const denied = client({ count_pending_workspace_join_requests: { data: null, error: { code: "42501" } } });
    await expect(readWorkspaceApprovals(denied, "cross-tenant")).resolves.toEqual({ pendingCount: 0 });
    await expect(readWorkspaceApprovals(denied)).resolves.toEqual({ pendingCount: 0 });
    expect(denied.rpc).toHaveBeenCalledTimes(1);
  });

  it("revalidates the newest approved target against an exact active membership even with 2+ memberships", () => {
    const request = (requestId: string, createdAt: string, slug: string) => ({ requestId, kind: "join" as const, status: "approved" as const, createdAt, resolvedAt: createdAt, decisionState: "approved" as const, approvedTargetSlug: slug, reviewDeadline: null });
    const memberships = [
      { orgId: "org-1", slug: "alpha-team", name: "알파", role: "member" as const },
      { orgId: "org-2", slug: "beta-team", name: "베타", role: "member" as const },
    ];
    expect(decideApprovedRequestTarget([
      request("10000000-0000-4000-8000-000000000001", "2026-07-26T00:00:00Z", "alpha-team"),
      request("20000000-0000-4000-8000-000000000002", "2026-07-27T00:00:00Z", "beta-team"),
    ], memberships, "20000000-0000-4000-8000-000000000002")).toEqual({ kind: "workspace", slug: "beta-team" });
    expect(decideApprovedRequestTarget([request("30000000-0000-4000-8000-000000000003", "2026-07-27T00:00:00Z", "other-team")], memberships, "30000000-0000-4000-8000-000000000003")).toEqual({ kind: "invalid" });
    expect(decideApprovedRequestTarget([{ ...request("40000000-0000-4000-8000-000000000004", "2026-07-27T00:00:00Z", "beta-team"), status: "pending" }], memberships, "40000000-0000-4000-8000-000000000004")).toEqual({ kind: "invalid" });
    expect(decideApprovedRequestTarget([{ ...request("50000000-0000-4000-8000-000000000005", "bad-time", "beta-team"), resolvedAt: null }], memberships, "50000000-0000-4000-8000-000000000005")).toEqual({ kind: "invalid" });
    expect(decideApprovedRequestTarget([request("60000000-0000-4000-8000-000000000006", "2026-07-27T00:00:00Z", "beta-team")], memberships)).toEqual({ kind: "none" });
    const duplicate = request("70000000-0000-4000-8000-000000000007", "2026-07-27T00:00:00Z", "beta-team");
    expect(decideApprovedRequestTarget([duplicate, { ...duplicate }], memberships, duplicate.requestId)).toEqual({ kind: "invalid" });
  });

  it("keeps a cancelled decision as non-pending self history", async () => {
    const rpc = client({
      is_platform_admin: { data: false, error: null },
      list_my_workspace_entry_requests: { data: [{ request_id: "r-cancelled", entry_kind: "join", request_status: "cancelled", created_at: "2026-07-27T00:00:00Z", resolved_at: "2026-07-27T00:01:00Z", decision_state: "cancelled", approved_target_slug: null }], error: null },
    });

    await expect(readWorkspaceEntryContext(rpc)).resolves.toMatchObject({
      kind: "ready",
      requests: [{ requestId: "r-cancelled", status: "cancelled", decisionState: "cancelled" }],
    });
  });
  it("loads only the narrow requester and authorized platform queue fields", async () => {
    const rpc = client({
      is_platform_admin: { data: true, error: null },
      list_my_workspace_entry_requests: { data: [{ request_id: "r1", entry_kind: "join", request_status: "pending", created_at: "2026-07-27T00:00:00Z", resolved_at: null, decision_state: "pending", approved_target_slug: null }], error: null },
      list_pending_workspace_create_requests: { data: [{ request_id: "r2", desired_name: "샘플 회사", desired_slug: "sample-team", created_at: "2026-07-27T00:00:00Z" }], error: null },
    });
    await expect(readWorkspaceEntryContext(rpc)).resolves.toMatchObject({
      kind: "ready",
      isPlatformAdmin: true,
      requests: [{ requestId: "r1", kind: "join" }],
      platformCreateRequests: [{ requestId: "r2", desiredSlug: "sample-team" }],
    });
  });

  it("loads a join queue only through the selected owner workspace argument", async () => {
    const rpc = client({
      is_platform_admin: { data: false, error: null },
      list_my_workspace_entry_requests: { data: [], error: null },
      list_pending_workspace_join_requests: { data: [{ request_id: "r3", requester_user_id: "user-3", created_at: "2026-07-27T00:00:00Z" }], error: null },
      count_pending_workspace_join_requests: { data: 1, error: null },
    });
    await expect(readWorkspaceEntryContext(rpc, "org-1")).resolves.toMatchObject({
      kind: "ready",
      isPlatformAdmin: false,
      ownerJoinRequests: [{ requestId: "r3", requesterUserId: "user-3" }],
      ownerPendingApprovalCount: 1,
    });
  });

  it("maps approval to the exact resolver without accepting a role or scope", async () => {
    const rpc = client({ resolve_workspace_join_request: { data: { accepted: true, status: "approved" }, error: null } });
    const result = await executeWorkspaceRequest(rpc, { kind: "resolve_join", requestId: "40000000-0000-4000-8000-000000000004", approve: true });
    expect(result).toMatchObject({ status: 200, result: { ok: true, state: "approved" } });
    expect(rpc.rpc).toHaveBeenCalledWith("resolve_workspace_join_request", {
      p_request_id: "40000000-0000-4000-8000-000000000004",
      p_approve: true,
      p_decision_code: "approved_by_owner",
    });
  });

  it("keeps RPC failures generic", async () => {
    const rpc = client({ submit_workspace_join_request: { data: null, error: { code: "42501" } } });
    const result = await executeWorkspaceRequest(rpc, { kind: "join", requestId: "50000000-0000-4000-8000-000000000005", lookup: "unknown" });
    expect(result.status).toBe(409);
    expect(JSON.stringify(result)).not.toContain("unknown");
  });

  it("rejects a malformed cancellation envelope instead of guessing a lifecycle state", async () => {
    const rpc = client({ cancel_workspace_entry_request: { data: { accepted: true }, error: null } });
    const result = await executeWorkspaceRequest(rpc, { kind: "cancel", requestId: "60000000-0000-4000-8000-000000000006" });
    expect(result).toMatchObject({ status: 409, result: { ok: false, state: "unavailable" } });
  });
});

describe("플랫폼 관리자 판정 폴백 (마이그레이션 017 적용 전에도 동작)", () => {
  const req = {
    data: [] as unknown,
    error: null as { code?: string } | null,
  };

  // 배포된 is_platform_admin()(006)은 app_admins.role='admin' 을 요구하는데 005 는
  // 예약 관리자를 role='owner' 로 넣는다 → 실제 관리자가 false 로 나온다.
  // 017 이 그 함수를 고치지만, 적용 전에도 관리자가 진입 화면에 갇히면 안 된다.
  it("is_platform_admin 이 false 여도 app_admin_role 이 역할을 주면 관리자로 인정한다", async () => {
    const rpc = client({
      is_platform_admin: { data: false, error: null },
      list_my_workspace_entry_requests: req,
      app_admin_role: { data: "owner", error: null },
      list_pending_workspace_create_requests: { data: [], error: null },
    });
    await expect(
      readWorkspaceEntryContext(rpc, undefined, "beliefkimkim@gmail.com"),
    ).resolves.toMatchObject({ kind: "ready", isPlatformAdmin: true });
    expect(rpc.rpc).toHaveBeenCalledWith("app_admin_role", {
      p_email: "beliefkimkim@gmail.com",
    });
  });

  it("app_admin_role 이 null 이면 일반 사용자로 남는다", async () => {
    const rpc = client({
      is_platform_admin: { data: false, error: null },
      list_my_workspace_entry_requests: req,
      app_admin_role: { data: null, error: null },
    });
    await expect(
      readWorkspaceEntryContext(rpc, undefined, "member@example.test"),
    ).resolves.toMatchObject({ kind: "ready", isPlatformAdmin: false });
  });

  it("폴백 RPC 가 실패해도 컨텍스트를 깨뜨리지 않는다(관리자 아님으로 남김)", async () => {
    const rpc = client({
      is_platform_admin: { data: false, error: null },
      list_my_workspace_entry_requests: req,
      app_admin_role: { data: null, error: { code: "42501" } },
    });
    await expect(
      readWorkspaceEntryContext(rpc, undefined, "member@example.test"),
    ).resolves.toMatchObject({ kind: "ready", isPlatformAdmin: false });
  });

  it("이메일이 없으면 폴백을 시도하지 않는다", async () => {
    const rpc = client({
      is_platform_admin: { data: false, error: null },
      list_my_workspace_entry_requests: req,
    });
    await expect(readWorkspaceEntryContext(rpc)).resolves.toMatchObject({
      isPlatformAdmin: false,
    });
    expect(rpc.rpc).not.toHaveBeenCalledWith("app_admin_role", expect.anything());
  });

  it("017 적용 후처럼 is_platform_admin 이 true 면 폴백을 부르지 않는다", async () => {
    const rpc = client({
      is_platform_admin: { data: true, error: null },
      list_my_workspace_entry_requests: req,
      list_pending_workspace_create_requests: { data: [], error: null },
    });
    await expect(
      readWorkspaceEntryContext(rpc, undefined, "beliefkimkim@gmail.com"),
    ).resolves.toMatchObject({ isPlatformAdmin: true });
    expect(rpc.rpc).not.toHaveBeenCalledWith("app_admin_role", expect.anything());
  });
});
