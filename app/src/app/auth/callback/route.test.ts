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
  /** Canonical auth.uid()-bound platform guard result. */
  platformGranted?: boolean;
  platformRpcError?: unknown;
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
      if (name === "is_platform_admin") {
        return { data: scenario.platformGranted ?? false, error: scenario.platformRpcError ?? null };
      }
      throw new Error(`Unexpected rpc: ${name}`);
    }),
  };
  mocks.createClient.mockResolvedValue(supabase);
  return { supabase, from, membershipSelect, membershipEq };
}

function callback(search = "code=test-code", cookie?: string) {
  return GET(new Request(`http://localhost:3100/auth/callback?${search}`, {
    headers: cookie ? { cookie } : undefined,
  }));
}

function location(response: Response) {
  return response.headers.get("location");
}

describe("OAuth callback Workspace routing", () => {
  beforeEach(() => mocks.createClient.mockReset());

  it("code/provider 교환 오류는 auth 오류로 닫는다", async () => {
    expect(location(await callback("next=/"))).toBe(
      "/login?error=auth",
    );
    setup({ exchangeError: { message: "provider" } });
    expect(location(await callback())).toBe(
      "/login?error=auth",
    );
  });

  it("provider user 오류와 profile 오류를 구분한다", async () => {
    setup({ userError: { message: "user" } });
    expect(location(await callback())).toBe(
      "/login?error=auth",
    );
    setup({ profileError: { message: "profile" } });
    expect(location(await callback())).toBe(
      "/login?error=profile",
    );
  });

  it("profile 실패는 확인된 플랫폼 권한보다 먼저 닫는다(병렬 조회 우선순위)", async () => {
    setup({ rows: [], platformGranted: true, profileError: { message: "profile" } });
    expect(location(await callback())).toBe(
      "/login?error=profile",
    );
  });

  it("profile 쓰기와 플랫폼 가드를 함께 발행한다(직렬 2단계가 아니다)", async () => {
    const ctx = setup({ rows: [] });
    let guardStarted = false;
    const innerRpc = ctx.supabase.rpc;
    ctx.supabase.rpc = vi.fn(async (name: string) => {
      guardStarted = true;
      return innerRpc(name);
    });
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    ctx.from.mockImplementation((table: string) => {
      if (table === "users") {
        return { upsert: vi.fn(() => writeGate.then(() => ({ error: null }))) };
      }
      if (table === "org_members") return { select: ctx.membershipSelect };
      throw new Error(`Unexpected table: ${table}`);
    });

    const pending = callback();
    // profile 쓰기가 끝나기 전에 가드가 출발해야 한다 — 직렬 코드라면
    // upsert 가 풀리기 전까지 rpc 는 절대 호출되지 않는다.
    await vi.waitFor(() => {
      expect(guardStarted).toBe(true);
    }, { timeout: 2000, interval: 10 });
    releaseWrite();
    expect(location(await pending)).toBe("/workspace-entry");
  });

  it("한 로그인의 플랫폼 판정이 다음 요청에 새지 않는다(요청 간 캐시 없음)", async () => {
    setup({ rows: [], platformGranted: true });
    expect(location(await callback())).toBe("/mode");
    const fresh = setup({ rows: [], platformGranted: false });
    expect(location(await callback())).toBe("/workspace-entry");
    expect(fresh.supabase.rpc).toHaveBeenCalledWith("is_platform_admin");
    expect(fresh.from).toHaveBeenCalledWith("org_members");
  });

  it("active membership 0은 membership 오류 없이 public entry로 보낸다", async () => {
    const { supabase, from } = setup({ rows: [] });
    const response = await callback();
    expect(location(response)).toBe(
      "/workspace-entry",
    );
    expect(response.headers.get("set-cookie")).toContain("mw_org=;");
    // Platform routing uses only the canonical auth.uid()-bound RPC.
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("is_platform_admin");
    expect(from).not.toHaveBeenCalledWith("orgs");
  });

  it("active membership 1은 canonical slug로 0-click 이동한다", async () => {
    setup({ rows: [membership("org-1", "alpha-team")] });
    const response = await callback();
    expect(location(response)).toBe("/w/alpha-team");
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
    expect(location(response)).toBe("/workspaces");
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
      "/workspace-entry",
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
        "/workspace-entry?error=routing",
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
      "/w/beta-team",
    );

    setup({ rows });
    expect(location(await callback("code=test-code&next=/w/other-team"))).toBe(
      "/workspace-entry?error=routing",
    );
  });

  it("2+ 멤버십에서 canonical deep link와 query를 그대로 복원한다", async () => {
    setup({ rows: [membership("org-alpha", "alpha-team"), membership("org-acme", "acme")] });
    const next = encodeURIComponent("/w/acme/deals/123?tab=notes");
    const response = await callback(`code=test-code&next=${next}`);
    expect(location(response)).toBe("/w/acme/deals/123?tab=notes");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-acme");
    expect(response.headers.get("set-cookie")).not.toContain("mw_org=org-alpha");
  });

  it("malicious encoded deep-link variants never become a workspace target", async () => {
    const rows = [membership("org-alpha", "alpha-team"), membership("org-acme", "acme")];
    for (const next of ["/w/acme/%252e%252e/admin", "/w/acme/%25252e%25252e/admin", "/w/acme/%25252fapi", "/w/acme/%252fapi", "/w/acme/%5cauth", "//evil.example/w/acme"]) {
      setup({ rows });
      expect(location(await callback(`code=test-code&next=${encodeURIComponent(next)}`))).toBe("/workspace-entry?error=routing");
    }
  });

  it("외부 next는 fail closed하고 유효한 일반 내부 path만 membership count를 따른다", async () => {
    const rows = [
      membership("org-1", "alpha-team"),
      membership("org-2", "beta-team"),
    ];
    setup({ rows });
    expect(location(await callback(`code=test-code&next=${encodeURIComponent("https://evil.example/w/alpha-team")}`))).toBe("/workspace-entry?error=routing");
    setup({ rows });
    expect(location(await callback(`code=test-code&next=${encodeURIComponent("/settings/account")}`))).toBe("/workspaces");
  });
});

describe("OAuth callback 플랫폼 관리자 분기", () => {
  // 버그: 플랫폼 관리자가 소속 0이면 진입 화면에 갇혔다. 어드민 링크는 회사 안
  // 스위처(⚙)에만 있어 회사에 못 들어가면 어드민에도 도달할 수 없었다.
  it("소속 0 + 확인된 플랫폼 운영자는 이전 선호를 지우고 /mode로 보낸다", async () => {
    const { from } = setup({ rows: [], platformGranted: true });
    const response = await callback(
      `code=test-code&next=${encodeURIComponent("/account?tab=privacy")}`,
      "mw_mode=v1.platform.stale-signature",
    );
    expect(location(response)).toBe("/mode?next=%2Faccount%3Ftab%3Dprivacy");
    expect(response.headers.get("set-cookie")).toContain("mw_mode=;");
    expect(from).not.toHaveBeenCalledWith("org_members");
  });

  it("소속 0 + 일반 사용자 → 기존대로 진입 화면", async () => {
    setup({ rows: [], platformGranted: false });
    expect(location(await callback())).toBe(
      "/workspace-entry",
    );
  });

  it("소속 1 + 플랫폼 관리자 → 회사로 (플랫폼 관리는 스위처 ⚙ 로)", async () => {
    setup({ rows: [membership("org-1", "alpha-team")], platformGranted: false });
    expect(location(await callback())).toBe(
      "/w/alpha-team",
    );
  });

  it("판정 RPC 가 실패하면 관리자 아님으로 수렴한다(장애가 권한 상승이 되지 않게)", async () => {
    setup({ rows: [], platformGranted: true, platformRpcError: { message: "boom" } });
    expect(location(await callback())).toBe(
      "/workspace-entry",
    );
  });

  it("알 수 없는 role 값은 관리자로 인정하지 않는다", async () => {
    setup({ rows: [membership("org-1", "alpha-team"), membership("org-2", "beta-team")], platformGranted: false });
    expect(location(await callback())).toBe(
      "/workspaces",
    );
  });
});

/*
 * #722 — 초대 링크로 온 사람은 «그 링크로» 돌아와야 한다.
 *
 * ★ 이 갈래가 없으면 링크를 누른 사람이 로그인 뒤 「신청하세요」 화면에 떨어진다 —
 *   소속이 0 이기 때문이다. 그러면 링크로 부르는 이유가 그대로 사라진다.
 *
 * ★★ 그리고 이 갈래는 «리다이렉트» 다. 모양 검사가 새면 열린 리다이렉트가 된다.
 *   그래서 「돌아간다」보다 「아무 데로도 안 간다」를 더 많이 잰다.
 */
describe("OAuth callback 초대 링크 복귀 (#722)", () => {
  beforeEach(() => mocks.createClient.mockReset());

  const TOKEN = "aBc123XyZ0kkQwErTyUiOp12";

  it("★ 소속이 0 이어도 초대 링크로 돌아간다 — 신청 화면으로 떨어지지 않는다", async () => {
    setup({ rows: [] });
    expect(location(await callback(`code=test-code&next=%2Fjoin%2F${TOKEN}`))).toBe(
      `/join/${TOKEN}`,
    );
  });

  it("★ 회사 쿠키를 심지 않는다 — 아직 들어간 것이 아니다", async () => {
    setup({ rows: [] });
    const response = await callback(`code=test-code&next=%2Fjoin%2F${TOKEN}`);
    expect(response.headers.get("set-cookie")).toContain("mw_org=;");
  });

  it("이미 다른 회사에 속해 있어도 초대 링크가 이긴다", async () => {
    setup({ rows: [membership("org-1", "alpha-team")] });
    expect(location(await callback(`code=test-code&next=%2Fjoin%2F${TOKEN}`))).toBe(
      `/join/${TOKEN}`,
    );
  });

  it.each([
    ["다른 사이트", "https%3A%2F%2Fevil.example%2Fjoin%2FaBc123XyZ0kkQwErTyUiOp12"],
    ["프로토콜 상대 주소", "%2F%2Fevil.example%2Fjoin%2FaBc123XyZ0kkQwErTyUiOp12"],
    ["경로 거슬러 오르기", "%2Fjoin%2F..%2Fsettings%2Fmembers"],
    ["한 겹 더", "%2Fjoin%2FaBc123XyZ0kkQwErTyUiOp12%2Fextra"],
    ["짧은 토큰", "%2Fjoin%2Fabc"],
    ["빈 토큰", "%2Fjoin%2F"],
    ["질의 붙임", "%2Fjoin%2FaBc123XyZ0kkQwErTyUiOp12%3Fx%3D1"],
  ])("★ %s 는 /join 으로 «안» 보낸다", async (_label, next) => {
    setup({ rows: [] });
    const target = location(await callback(`code=test-code&next=${next}`)) ?? "";
    expect(target.includes("/join/")).toBe(false);
  });

  it("★ 플랫폼 관리자는 기존 /mode 갈래를 그대로 탄다 — 초대가 그것을 가로채지 않는다", async () => {
    setup({ rows: [], platformGranted: true });
    expect((location(await callback(`code=test-code&next=%2Fjoin%2F${TOKEN}`)) ?? "").startsWith("/mode")).toBe(true);
  });

  it("★ 멤버십을 읽지 않는다 — 어차피 회사로 안 보내므로 왕복을 늘리지 않는다", async () => {
    const { from } = setup({ rows: [] });
    await callback(`code=test-code&next=%2Fjoin%2F${TOKEN}`);
    expect(from).not.toHaveBeenCalledWith("org_members");
  });
});
