import { describe, expect, it, vi } from "vitest";
import { readWorkspaceRoutingSnapshot } from "./workspace-entry-server";
import { MEMBER_ROLES } from "./roles";

function membership(orgId: string, slug: string, status = "active", role = "member") {
  return {
    org_id: orgId,
    status,
    role,
    scope: "assigned",
    created_at: "2026-01-01T00:00:00.000Z",
    orgs: {
      id: orgId,
      slug,
      status: "active",
      name: `회사 ${orgId}`,
      plan_tier: "t1_3",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

function client(rows: unknown[], user: { id: string } | null = { id: "user-1" }, selfState: unknown = "eligible_entry", selfStateError: unknown = null) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn(() => ({ select })),
    rpc: vi.fn().mockResolvedValue({ data: selfState, error: selfStateError }),
  };
}

describe("auth-only workspace routing loader", () => {
  it.each([
    [0, []],
    [1, [membership("org-1", "alpha-team")]],
    [2, [membership("org-1", "alpha-team"), membership("org-2", "beta-team")]],
  ])("loads %i active memberships without a selected mw_org", async (count, rows) => {
    const result = await readWorkspaceRoutingSnapshot(client(rows));
    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind === "ready") {
      expect(result.memberships).toHaveLength(count);
      expect(result.selfRouteState).toBe("eligible_entry");
    }
  });

  it("excludes inactive rows and fails closed for malformed relations", async () => {
    await expect(readWorkspaceRoutingSnapshot(client([membership("org-1", "alpha-team", "suspended")]))).resolves.toEqual({ kind: "ready", memberships: [], selfRouteState: "eligible_entry" });
    await expect(readWorkspaceRoutingSnapshot(client([{ org_id: "org-1", status: "active", orgs: null }]))).resolves.toEqual({ kind: "error" });
  });

  it("does not treat an unauthenticated visitor as a zero-membership user", async () => {
    await expect(readWorkspaceRoutingSnapshot(client([], null))).resolves.toEqual({ kind: "unauthenticated" });
  });

  /*
   * ★ 여기 이 시험이 «없어서» 팀장인 사람이 제품에 못 들어왔다 (#676).
   *
   * 이 파일의 fixture 는 오래도록 `role: "member"` 하나로 고정이었다.
   * 그래서 «역할을 바꿔 보는» 시험이 하나도 없었고, 2026-08-11 에 `team_lead` 가
   * 생겼을 때 로더의 손으로 적은 역할 목록이 안 따라온 것을 아무도 못 봤다.
   *
   *     드롭다운에 「팀장」이 있다        조직관리 화면
   *     RPC 가 org_members.role 에 쓴다  «owner 만» 거부한다
   *     enum 이 받는다                   migration 054
   *     → 로더가 스냅샷 «전체» 를 error 로 만든다 → 어느 회사에도 못 들어간다
   *
   * ★★ 그래서 이 시험은 역할을 «손으로 적지 않는다». MEMBER_ROLES 를 돈다 —
   *    역할이 늘면 이 시험도 자동으로 같이 늘어난다. 그것이 요점이다.
   */
  it.each(MEMBER_ROLES.map((role) => [role]))(
    "★ %s 인 사람도 자기 회사에 들어올 수 있다 — 역할이 늘어도 문이 안 닫힌다",
    async (role) => {
      const result = await readWorkspaceRoutingSnapshot(
        client([membership("org-1", "alpha-team", "active", role)]),
      );
      expect(result.kind, `${role} 이 통째로 튕겼다`).toBe("ready");
      if (result.kind === "ready") {
        expect(result.memberships).toHaveLength(1);
        expect(result.memberships[0].role).toBe(role);
      }
    },
  );

  /*
   * ★ 이 Issue 의 «제목» 이 말하는 것 — 한 회사가 이상하다고 다른 회사까지 죽이지 않는다.
   *   전에는 루프 안에서 `return { kind: "error" }` 였다. 그래서 회사 하나가 이상하면
   *   그 사람의 «멀쩡한 회사들까지» 같이 사라졌다. fail-closed 는 옳지만
   *   «무엇을 닫을 것인가» 가 틀렸다 — 그 회사만 닫아야 한다.
   */
  it("★ 회사 하나가 이상해도 «나머지 회사» 는 그대로 보인다", async () => {
    const rows = [
      { ...membership("org-bad", "bad-team"), role: "정체불명" },
      membership("org-good", "good-team"),
    ];
    const result = await readWorkspaceRoutingSnapshot(client(rows));
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.memberships.map((m) => m.slug)).toEqual(["good-team"]);
    }
  });

  it("이름이 빈 회사도 «그 회사만» 빠진다", async () => {
    const bad = membership("org-bad", "bad-team");
    bad.orgs.name = "   ";
    const result = await readWorkspaceRoutingSnapshot(client([bad, membership("org-good", "good-team")]));
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.memberships.map((m) => m.slug)).toEqual(["good-team"]);
    }
  });

  it("binds the exact no-arg self-state RPC and fails closed on unknown or error", async () => {
    const blocked = client([], { id: "user-1" }, "blocked_inactive");
    await expect(readWorkspaceRoutingSnapshot(blocked)).resolves.toEqual({ kind: "ready", memberships: [], selfRouteState: "blocked_inactive" });
    expect(blocked.rpc).toHaveBeenCalledWith("workspace_entry_self_route_state");
    await expect(readWorkspaceRoutingSnapshot(client([], { id: "user-1" }, "unknown"))).resolves.toEqual({ kind: "error" });
    await expect(readWorkspaceRoutingSnapshot(client([], { id: "user-1" }, "eligible_entry", { code: "42501" }))).resolves.toEqual({ kind: "error" });
  });
});
