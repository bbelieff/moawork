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
