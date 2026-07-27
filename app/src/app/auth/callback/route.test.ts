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
    rpc: vi.fn(),
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
    expect(supabase.rpc).not.toHaveBeenCalled();
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
