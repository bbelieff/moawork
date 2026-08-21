import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkspaceRequest } from "./handler";
import { POST } from "./route";
import type { WorkspaceEntryRpcClient } from "@/lib/workspace-entry/server";

function rpcClient(data: unknown = { accepted: true, status: "pending" }): WorkspaceEntryRpcClient {
  return { rpc: async () => ({ data, error: null }) };
}

describe("POST /api/workspace-requests", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("rejects invalid create input without revealing availability cause", async () => {
    const response = await POST(new Request("https://www.moa-work.com/api/workspace-requests", { method: "POST", body: JSON.stringify({ kind: "create", displayName: "모아", slug: "login" }) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, state: "invalid", message: "이 회사 주소는 사용할 수 없어요." });
  });

  it("fails closed with a public-safe response when the development workspace is not connected", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const response = await POST(new Request("https://www.moa-work.com/api/workspace-requests", {
      method: "POST",
      body: JSON.stringify({ kind: "join", lookup: "alpha-team", requestId: "90000000-0000-4000-8000-000000000009" }),
    }));
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("연결된 워크스페이스");
    expect(body).not.toContain("NEXT_PUBLIC_");
    expect(body).not.toContain(".env");
  });

  it("submits create and both neutral join lookup shapes through authenticated RPCs", async () => {
    for (const body of [
      { kind: "create", displayName: "모아", slug: "moa-team", requestId: "10000000-0000-4000-8000-000000000001" },
      { kind: "join", lookup: "alpha-team", requestId: "10000000-0000-4000-8000-000000000002" },
      { kind: "join", lookup: "INVITE-OPAQUE-24", requestId: "10000000-0000-4000-8000-000000000003" },
    ]) {
      const response = await handleWorkspaceRequest(
        new Request("https://www.moa-work.com/api/workspace-requests", { method: "POST", body: JSON.stringify(body) }),
        async () => ({ kind: "ready", memberships: [] }),
        async () => rpcClient(),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, state: "pending" });
    }
  });

  it("bootstraps an auto-approved workspace before returning its redirect", async () => {
    const calls: string[] = [];
    const client = rpcClient({ accepted: true, status: "approved", auto_approved: true, slug: "new-team" });
    const response = await handleWorkspaceRequest(
      new Request("https://www.moa-work.com/api/workspace-requests", {
        method: "POST",
        body: JSON.stringify({ kind: "create", displayName: "새 회사", slug: "new-team", requestId: "11000000-0000-4000-8000-000000000001" }),
      }),
      async () => ({ kind: "ready", memberships: [] }),
      async () => client,
      async (received, slug) => {
        expect(received).toBe(client);
        calls.push(slug);
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, redirectTo: "/w/new-team" });
    expect(calls).toEqual(["new-team"]);
  });

  it("fails closed when approved workspace bootstrap is incomplete and allows request replay", async () => {
    const input = () => new Request("https://www.moa-work.com/api/workspace-requests", {
      method: "POST",
      body: JSON.stringify({ kind: "create", displayName: "새 회사", slug: "new-team", requestId: "12000000-0000-4000-8000-000000000001" }),
    });
    const client = rpcClient({ accepted: true, status: "approved", auto_approved: true, slug: "new-team" });
    let attempt = 0;
    const bootstrap = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("partial bootstrap");
    };
    const first = await handleWorkspaceRequest(input(), async () => ({ kind: "ready", memberships: [] }), async () => client, bootstrap);
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({ ok: false, state: "unavailable" });
    const replay = await handleWorkspaceRequest(input(), async () => ({ kind: "ready", memberships: [] }), async () => client, bootstrap);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ ok: true, redirectTo: "/w/new-team" });
    expect(attempt).toBe(2);
  });

  it("binds every resume helper to the 14-day server review window", async () => {
    const cases = [
      [{ kind: "create", displayName: "모아", slug: "moa-team", requestId: "60000000-0000-4000-8000-000000000006" }, "create.60000000-0000-4000-8000-000000000006", "1209600"],
      [{ kind: "join", lookup: "alpha-team", requestId: "70000000-0000-4000-8000-000000000007" }, "join.70000000-0000-4000-8000-000000000007", "1209600"],
    ] as const;
    for (const [body, value, maxAge] of cases) {
      const response = await handleWorkspaceRequest(new Request("https://www.moa-work.com/api/workspace-requests", { method: "POST", body: JSON.stringify(body) }), async () => ({ kind: "ready", memberships: [] }), async () => rpcClient());
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain(`mw_entry_resume=${value}`);
      expect(cookie).toContain(`Max-Age=${maxAge}`);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=lax");
    }
  });

  it("keeps an expired cancellation generic while allowing a retry", async () => {
    const response = await handleWorkspaceRequest(
      new Request("https://www.moa-work.com/api/workspace-requests", { method: "POST", body: JSON.stringify({ kind: "cancel", requestId: "80000000-0000-4000-8000-000000000008" }) }),
      async () => ({ kind: "ready", memberships: [] }),
      async () => rpcClient({ accepted: true, status: "expired" }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, state: "expired", message: "요청 기간이 끝났어요. 필요하면 새 요청을 보낼 수 있어요." });
  });

  it("requires a chooser selection to match one freshly loaded active membership", async () => {
    const input = new Request("https://www.moa-work.com/api/workspace-requests", { method: "POST", body: JSON.stringify({ kind: "select_workspace", workspaceId: "org-2" }) });
    const response = await handleWorkspaceRequest(input, async () => ({
      kind: "ready",
      memberships: [
        { orgId: "org-1", slug: "alpha-team", name: "알파팀", role: "member" },
        { orgId: "org-2", slug: "beta-team", name: "베타팀", role: "member" },
      ],
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, state: "selection_revalidation", redirectTo: "/w/beta-team" });
  });

  it("denies stale or cross-tenant chooser identifiers without revealing a tenant", async () => {
    const input = new Request("https://www.moa-work.com/api/workspace-requests", { method: "POST", body: JSON.stringify({ kind: "select_workspace", workspaceId: "cross-tenant" }) });
    const response = await handleWorkspaceRequest(input, async () => ({
      kind: "ready",
      memberships: [{ orgId: "org-1", slug: "alpha-team", name: "알파팀", role: "member" }],
    }));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, state: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("alpha-team");
  });

  it("returns the same envelope for guessed existing and nonexistent request ids", async () => {
    for (const code of ["42501", "P0002"]) {
      const response = await handleWorkspaceRequest(
        new Request("https://www.moa-work.com/api/workspace-requests", { method: "POST", body: JSON.stringify({ kind: "cancel", requestId: code === "42501" ? "20000000-0000-4000-8000-000000000001" : "20000000-0000-4000-8000-000000000002" }) }),
        async () => ({ kind: "ready", memberships: [] }),
        async () => ({ rpc: async () => ({ data: null, error: { code } }) }),
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ ok: false, state: "unavailable", message: "요청을 지금 처리할 수 없어요. 목록을 새로 확인한 뒤 다시 시도해 주세요." });
    }
  });
});
