import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "./route";

type Scenario = {
  rows?: unknown[];
  exchangeError?: unknown;
  userError?: unknown;
  profileError?: unknown;
  membershipError?: unknown;
  /** app_admin_role RPC 가 돌려줄 값. null = 관리자 아님(기본). */
  adminRole?: unknown;
  adminRpcError?: unknown;
};

function membership(
  orgId: string,
  slug: string | null,
  memberStatus = "active",
  workspaceStatus = "active",
) {
  return {
    org_id: orgId,
    status: memberStatus,
    role: "member",
    scope: "assigned",
    orgs: {
      id: orgId,
      slug,
      status: workspaceStatus,
      name: "테스트 회사",
      plan_tier: "t1_3",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

function setup(scenario: Scenario = {}) {
  const profileUpsert = vi.fn().mockResolvedValue({
    error: scenario.profileError ?? null,
  });
  const membershipEq = vi.fn().mockResolvedValue({
    data: scenario.rows ?? [],
    error: scenario.membershipError ?? null,
  });
  const membershipSelect = vi.fn(() => ({ eq: membershipEq }));
  const from = vi.fn((table: string) => {
    if (table === "users") return { upsert: profileUpsert };
    if (table === "org_members") return { select: membershipSelect };
    throw new Error(`Unexpected table: ${table}`);
  });
  const supabase = {
    auth: {
      exchangeCodeForSession: vi
        .fn()
        .mockResolvedValue({ error: scenario.exchangeError ?? null }),
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: scenario.userError
            ? null
            : {
                id: "user-1",
                email: "member@example.test",
                user_metadata: { name: "Member" },
              },
        },
        error: scenario.userError ?? null,
      }),
    },
    from,
    rpc: vi.fn(async (name: string) => {
      if (name === "app_admin_role") {
        return { data: scenario.adminRole ?? null, error: scenario.adminRpcError ?? null };
      }
      throw new Error(`Unexpected rpc: ${name}`);
    }),
  };
  mocks.createClient.mockResolvedValue(supabase);
  return { supabase, from, membershipSelect, membershipEq };
}

function callback(search = "code=test-code") {
  return GET(new Request(`https://www.moa-work.com/auth/callback?${search}`));
}

function location(response: Response) {
  return response.headers.get("location");
}

describe("OAuth callback Workspace routing", () => {
  beforeEach(() => mocks.createClient.mockReset());

  it("code/provider 교환 오류는 auth 오류로 닫는다", async () => {
    expect(location(await callback("next=/"))).toBe(
      "https://www.moa-work.com/login?error=auth",
    );
    setup({ exchangeError: { message: "provider" } });
    expect(location(await callback())).toBe(
      "https://www.moa-work.com/login?error=auth",
    );
  });

  it("provider user 오류와 profile 오류를 구분한다", async () => {
    setup({ userError: { message: "user" } });
    expect(location(await callback())).toBe(
      "https://www.moa-work.com/login?error=auth",
    );
    setup({ profileError: { message: "profile" } });
    expect(location(await callback())).toBe(
      "https://www.moa-work.com/login?error=profile",
    );
  });

  it("active membership 0은 membership 오류 없이 public entry로 보낸다", async () => {
    const { supabase, from } = setup({ rows: [] });
    const response = await callback();
    expect(location(response)).toBe(
      "https://www.moa-work.com/workspace-entry",
    );
    expect(response.headers.get("set-cookie")).toContain("mw_org=;");
    // 플랫폼 분기 판정을 위해 app_admin_role 만 부른다(그 외 RPC·orgs 직접 조회는 없다).
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("app_admin_role", {
      p_email: "member@example.test",
    });
    expect(from).not.toHaveBeenCalledWith("orgs");
  });

  it("active membership 1은 canonical slug로 0-click 이동한다", async () => {
    setup({ rows: [membership("org-1", "alpha-team")] });
    const response = await callback();
    expect(location(response)).toBe("https://www.moa-work.com/w/alpha-team");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-1");
  });

  it("active membership 2+는 첫 행·role과 무관하게 chooser로 보낸다", async () => {
    setup({
      rows: [
        { ...membership("org-owner", "owner-team"), role: "owner" },
        membership("org-member", "member-team"),
      ],
    });
    const response = await callback();
    expect(location(response)).toBe("https://www.moa-work.com/workspaces");
    expect(response.headers.get("set-cookie")).toContain("mw_org=;");
  });

  it("inactive rows는 active count에서 제외한다", async () => {
    setup({
      rows: [
        membership("org-1", "alpha-team", "removed"),
        membership("org-2", "beta-team", "active", "suspended"),
      ],
    });
    expect(location(await callback())).toBe(
      "https://www.moa-work.com/workspace-entry",
    );
  });

  it("missing/duplicate slug와 query 오류는 generic fail-closed다", async () => {
    for (const scenario of [
      { rows: [membership("org-1", null)] },
      {
        rows: [
          membership("org-1", "same-team"),
          membership("org-2", "same-team"),
        ],
      },
      { membershipError: { message: "query" } },
    ]) {
      setup(scenario);
      expect(location(await callback())).toBe(
        "https://www.moa-work.com/workspace-entry?error=routing",
      );
    }
  });

  it("accepted target는 현재 active membership과 일치할 때만 우선한다", async () => {
    const rows = [
      membership("org-1", "alpha-team"),
      membership("org-2", "beta-team"),
    ];
    setup({ rows });
    expect(location(await callback("code=test-code&next=/w/beta-team"))).toBe(
      "https://www.moa-work.com/w/beta-team",
    );

    setup({ rows });
    expect(location(await callback("code=test-code&next=/w/other-team"))).toBe(
      "https://www.moa-work.com/workspace-entry?error=routing",
    );
  });

  it("2+ 멤버십에서 canonical deep link와 query를 그대로 복원한다", async () => {
    setup({ rows: [membership("org-alpha", "alpha-team"), membership("org-acme", "acme")] });
    const next = encodeURIComponent("/w/acme/deals/123?tab=notes");
    const response = await callback(`code=test-code&next=${next}`);
    expect(location(response)).toBe("https://www.moa-work.com/w/acme/deals/123?tab=notes");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-acme");
    expect(response.headers.get("set-cookie")).not.toContain("mw_org=org-alpha");
  });

  it("malicious encoded deep-link variants never become a workspace target", async () => {
    const rows = [membership("org-alpha", "alpha-team"), membership("org-acme", "acme")];
    for (const next of ["/w/acme/%252e%252e/admin", "/w/acme/%25252e%25252e/admin", "/w/acme/%25252fapi", "/w/acme/%252fapi", "/w/acme/%5cauth", "//evil.example/w/acme"]) {
      setup({ rows });
      expect(location(await callback(`code=test-code&next=${encodeURIComponent(next)}`))).toBe("https://www.moa-work.com/workspace-entry?error=routing");
    }
  });

  it("외부 next는 fail closed하고 유효한 일반 내부 path만 membership count를 따른다", async () => {
    const rows = [
      membership("org-1", "alpha-team"),
      membership("org-2", "beta-team"),
    ];
    setup({ rows });
    expect(location(await callback(`code=test-code&next=${encodeURIComponent("https://evil.example/w/alpha-team")}`))).toBe("https://www.moa-work.com/workspace-entry?error=routing");
    setup({ rows });
    expect(location(await callback(`code=test-code&next=${encodeURIComponent("/settings/account")}`))).toBe("https://www.moa-work.com/workspaces");
  });
});

describe("OAuth callback 플랫폼 관리자 분기", () => {
  // 버그: 플랫폼 관리자가 소속 0이면 진입 화면에 갇혔다. 어드민 링크는 회사 안
  // 스위처(⚙)에만 있어 회사에 못 들어가면 어드민에도 도달할 수 없었다.
  it("소속 0 + 플랫폼 관리자 → /platform 으로 보낸다", async () => {
    setup({ rows: [], adminRole: "owner" });
    expect(location(await callback())).toBe("https://www.moa-work.com/platform");
  });

  it("소속 0 + 일반 사용자 → 기존대로 진입 화면", async () => {
    setup({ rows: [], adminRole: null });
    expect(location(await callback())).toBe(
      "https://www.moa-work.com/workspace-entry",
    );
  });

  it("소속 1 + 플랫폼 관리자 → 회사로 (플랫폼 관리는 스위처 ⚙ 로)", async () => {
    setup({ rows: [membership("org-1", "alpha-team")], adminRole: "owner" });
    expect(location(await callback())).toBe(
      "https://www.moa-work.com/w/alpha-team",
    );
  });

  it("판정 RPC 가 실패하면 관리자 아님으로 수렴한다(장애가 권한 상승이 되지 않게)", async () => {
    setup({ rows: [], adminRole: "owner", adminRpcError: { message: "boom" } });
    expect(location(await callback())).toBe(
      "https://www.moa-work.com/workspace-entry",
    );
  });

  it("알 수 없는 role 값은 관리자로 인정하지 않는다", async () => {
    setup({ rows: [], adminRole: "superuser" });
    expect(location(await callback())).toBe(
      "https://www.moa-work.com/workspace-entry",
    );
  });
});
