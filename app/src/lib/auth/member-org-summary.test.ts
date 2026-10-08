import { describe, expect, it, vi } from "vitest";
import { applyMemberProfiles, buildMemberOrgSummary, loadMemberOrgSummaryWithClient } from "./member-org-summary";
import { MEMBER_ROLES, MEMBER_SCOPES } from "@/lib/types";

describe("buildMemberOrgSummary", () => {
  const owner = { org_id: "org-a", user_id: "owner-a", role: "owner", scope: "all", created_at: "2026-01-01T00:00:00Z", users: { name: "대표" } };

  it("puts the one protected owner first and groups other active memberships without ranking", () => {
    const summary = buildMemberOrgSummary("org-a", [
      owner,
      { org_id: "org-a", user_id: "member-a", role: "member", scope: "assigned", created_at: "2026-01-03T00:00:00Z", users: { name: "사원" } },
      { org_id: "org-a", user_id: "admin-a", role: "admin", scope: "all", created_at: "2026-01-02T00:00:00Z", users: { name: "팀장" } },
      { org_id: "org-b", user_id: "foreign", role: "owner", scope: "all", created_at: "2026-01-01T00:00:00Z", users: { name: "다른 회사" } },
    ]);
    expect(summary).toMatchObject({ kind: "ready", owner: { userId: "owner-a" } });
    if (summary.kind !== "ready") throw new Error("expected ready");
    expect(summary.admins.map((member) => member.userId)).toEqual(["admin-a"]);
    expect(summary.members.map((member) => member.userId)).toEqual(["member-a"]);
  });

  it("fails closed when the protected owner is absent, duplicated, or not all-scope", () => {
    expect(buildMemberOrgSummary("org-a", [])).toEqual({ kind: "owner_integrity_error" });
    expect(buildMemberOrgSummary("org-a", [owner, { ...owner, user_id: "owner-b" }])).toEqual({ kind: "owner_integrity_error" });
    expect(buildMemberOrgSummary("org-a", [{ ...owner, scope: "assigned" }])).toEqual({ kind: "owner_integrity_error" });
  });

  // BBE-88: "승인자가 대표로 표시된다"는 관측의 원인 계층을 고정한다.
  // 대표 카드는 org_members.role='owner' 행에서만 나온다 — 요청을 처리한 사람이
  // admin/member 로 들어와도 대표가 되지 않고, owner 행이 안 보이면 fail-close 한다.
  it("never promotes a non-owner membership to the protected owner card", () => {
    const resolver = { org_id: "org-a", user_id: "resolver-a", role: "admin", scope: "all", created_at: "2025-12-31T00:00:00Z", users: { name: "승인자" } };
    const summary = buildMemberOrgSummary("org-a", [resolver, owner]);
    expect(summary).toMatchObject({ kind: "ready", owner: { userId: "owner-a" } });
    if (summary.kind !== "ready") throw new Error("expected ready");
    expect(summary.admins.map((member) => member.userId)).toEqual(["resolver-a"]);

    // 요청자의 owner 행이 RLS·status 로 안 보이면 남은 행을 대표로 승격하지 않는다.
    expect(buildMemberOrgSummary("org-a", [resolver])).toEqual({ kind: "owner_integrity_error" });
  });

  it("uses the 011 profile RPC shape for display fields and fails closed on a mismatched profile", () => {
    const summary = buildMemberOrgSummary("org-a", [owner]);
    const hydrated = applyMemberProfiles(summary, new Map([
      ["owner-a", { id: "owner-a", name: "대표", title: "대표", team_key: "leadership" }],
    ]));
    expect(hydrated).toMatchObject({ kind: "ready", owner: { title: "대표", teamKey: "leadership" } });
    expect(applyMemberProfiles(summary, new Map([["owner-a", { id: "other", name: "대표" }]]))).toEqual({ kind: "error" });
  });
});

/*
 * #683 검수 P0-1 — 「팀장이 앉아 있는데 화면이 «공석» 이라 붉게 단언한다」의 뿌리.
 *
 * isRole/isScope 가드가 목록을 «손으로» 적어 두고 정본(MEMBER_ROLES · MEMBER_SCOPES)보다
 * 좁았다. team_lead 와 department 가 빠져 있었고, 그 행들이 여기서 «조용히» 버려졌다.
 * 사람이 사라지는 것을 아무도 못 봤고, 자리 갈래가 그 부서를 「팀장 없음」으로 읽었다.
 *
 * ★ 그래서 재는 것은 「team_lead 가 통과하나」가 아니라
 *   **「정본에 있는 값이 하나라도 버려지나」** 다. 역할이 하나 더 생겨도 이 시험이 잡는다.
 */
describe("#683 역할·범위 가드는 정본보다 좁으면 안 된다", () => {
  const protectedOwner = {
    org_id: "org-a", user_id: "owner-a", role: "owner", scope: "all",
    created_at: "2026-01-01T00:00:00Z", users: { name: "대표" },
  };

  it("★ MEMBER_ROLES 의 모든 값이 살아남는다 — 하나라도 버려지면 그 사람이 화면에서 사라진다", () => {
    const rows = MEMBER_ROLES.filter((role) => role !== "owner").map((role, index) => ({
      org_id: "org-a", user_id: `u-${role}`, role, scope: "all",
      created_at: `2026-01-0${index + 2}T00:00:00Z`, users: { name: role },
    }));
    const summary = buildMemberOrgSummary("org-a", [protectedOwner, ...rows]);
    if (summary.kind !== "ready") throw new Error(`expected ready, got ${summary.kind}`);

    const seen = [summary.owner, ...summary.admins, ...summary.members].map((member) => member.userId);
    for (const role of MEMBER_ROLES) {
      if (role === "owner") continue;
      expect(seen, `${role} 이(가) 조용히 버려졌다`).toContain(`u-${role}`);
    }
  });

  it("★ MEMBER_SCOPES 의 모든 값이 살아남는다 — department 가 빠져 있었다", () => {
    const rows = MEMBER_SCOPES.map((scope, index) => ({
      org_id: "org-a", user_id: `s-${scope}`, role: "member", scope,
      created_at: `2026-02-0${index + 1}T00:00:00Z`, users: { name: scope },
    }));
    const summary = buildMemberOrgSummary("org-a", [protectedOwner, ...rows]);
    if (summary.kind !== "ready") throw new Error(`expected ready, got ${summary.kind}`);

    for (const scope of MEMBER_SCOPES) {
      expect(summary.members.map((member) => member.userId), `${scope} 이(가) 조용히 버려졌다`).toContain(`s-${scope}`);
    }
  });

  it("정본에 없는 값은 그대로 버린다 — 넓히기만 하고 아무거나 받지는 않는다", () => {
    const summary = buildMemberOrgSummary("org-a", [
      protectedOwner,
      { org_id: "org-a", user_id: "bogus", role: "superuser", scope: "all", created_at: "2026-03-01T00:00:00Z", users: { name: "가짜" } },
    ]);
    if (summary.kind !== "ready") throw new Error("expected ready");
    expect([...summary.admins, ...summary.members].map((member) => member.userId)).not.toContain("bogus");
  });
});

describe("Issue 857 — 회원 표시 정보는 한 번에(170) 읽는다", () => {
  const ctx = { org: { id: "org-a" } } as never;
  const rows = [
    { org_id: "org-a", user_id: "owner-a", role: "owner", scope: "all", created_at: "2026-01-01T00:00:00Z", users: { name: "대표" } },
    { org_id: "org-a", user_id: "member-a", role: "member", scope: "assigned", created_at: "2026-01-02T00:00:00Z", users: { name: "사원" } },
  ];
  function client(batch: { data: unknown; error: { code?: string; message?: string } | null }) {
    const order = vi.fn(async () => ({ data: rows, error: null }));
    const query = { select: () => query, eq: () => query, order };
    const rpc = vi.fn(async (name: string, args: { p_target_user_id?: string }) => name === "list_member_account_profiles"
      ? batch
      : { data: { id: args.p_target_user_id, name: "하나씩", title: null, team_key: null }, error: null });
    return { client: { from: () => query, rpc } as never, rpc };
  }

  it("회원 목록과 표시 정보를 같이 읽고 사람마다 따로 묻지 않는다", async () => {
    const { client: supabase, rpc } = client({
      data: [
        { id: "owner-a", name: "대표", title: null, team_key: null },
        { id: "member-a", name: "사원", title: "매니저", team_key: "team-1" },
      ],
      error: null,
    });
    const summary = await loadMemberOrgSummaryWithClient(supabase, ctx);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["list_member_account_profiles"]);
    expect(summary).toMatchObject({ kind: "ready", owner: { userId: "owner-a" }, members: [{ userId: "member-a", title: "매니저", teamKey: "team-1" }] });
  });

  it("함수가 아직 없는 DB 에서만 예전처럼 사람마다 읽는다", async () => {
    const { client: supabase, rpc } = client({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const summary = await loadMemberOrgSummaryWithClient(supabase, ctx);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "list_member_account_profiles", "get_member_account_profile", "get_member_account_profile",
    ]);
    expect(summary.kind).toBe("ready");
  });

  it("다른 실패는 닫는다(권한 없음 등)", async () => {
    const { client: supabase } = client({ data: null, error: { code: "42501", message: "active membership required" } });
    expect(await loadMemberOrgSummaryWithClient(supabase, ctx)).toEqual({ kind: "error" });
  });
});
