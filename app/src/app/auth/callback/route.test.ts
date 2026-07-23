import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "./route";

describe("OAuth callback owner provisioning", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
  });

  it("조직 ID를 먼저 만들고 RETURNING 없이 삽입한다", async () => {
    const orgInsert = vi.fn().mockResolvedValue({ error: null });
    const membershipEq = vi.fn().mockResolvedValue({ data: [], error: null });
    const membershipSelect = vi.fn(() => ({ eq: membershipEq }));
    const profileUpsert = vi.fn().mockResolvedValue({ error: null });

    const rpc = vi.fn(
      async (name: string, args: Record<string, string> | undefined) => {
        if (name === "app_admin_role") {
          return { data: "owner", error: null };
        }
        if (name === "bootstrap_workspace") {
          return {
            data: {
              org_id: args?.p_org_id,
              pipeline_id: "pipeline-1",
              entitlements_created: 6,
              stages_created: 6,
            },
            error: null,
          };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
    );
    const supabase = {
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "owner@example.com",
              user_metadata: { name: "Owner" },
            },
          },
          error: null,
        }),
      },
      rpc,
      from: vi.fn((table: string) => {
        if (table === "users") return { upsert: profileUpsert };
        if (table === "org_members") return { select: membershipSelect };
        if (table === "orgs") return { insert: orgInsert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    mocks.createClient.mockResolvedValue(supabase);

    const response = await GET(
      new Request("https://www.moa-work.com/auth/callback?code=test-code"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://www.moa-work.com/onboarding?first=1",
    );
    expect(orgInsert).toHaveBeenCalledTimes(1);
    expect(orgInsert).toHaveBeenCalledWith({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      name: "MoaWork 데모 조직",
    });
    expect(rpc).toHaveBeenCalledWith("bootstrap_workspace", {
      p_org_id: expect.any(String),
    });
    expect(response.headers.get("set-cookie")).toContain("mw_org=");
  });

  it("기존 owner 조직은 bootstrap하고 안전한 next 경로로 보낸다", async () => {
    const rpc = vi.fn(
      async (name: string, args: Record<string, string> | undefined) => {
        if (name === "app_admin_role") return { data: null, error: null };
        if (name === "bootstrap_workspace") {
          return {
            data: {
              org_id: args?.p_org_id,
              pipeline_id: "pipeline-1",
              entitlements_created: 0,
              stages_created: 0,
            },
            error: null,
          };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
    );
    const supabase = callbackClient({
      memberships: [{ org_id: "org-owner", role: "owner" }],
      rpc,
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await GET(
      new Request(
        "https://www.moa-work.com/auth/callback?code=test-code&next=/boards",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://www.moa-work.com/boards",
    );
    expect(rpc).toHaveBeenCalledWith("bootstrap_workspace", {
      p_org_id: "org-owner",
    });
  });

  it("여러 membership 중 뒤에 있는 owner 조직을 우선 bootstrap한다", async () => {
    const rpc = vi.fn(
      async (name: string, args: Record<string, string> | undefined) => {
        if (name === "app_admin_role") return { data: null, error: null };
        if (name === "bootstrap_workspace") {
          return {
            data: {
              org_id: args?.p_org_id,
              pipeline_id: "pipeline-owner",
              entitlements_created: 0,
              stages_created: 0,
            },
            error: null,
          };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
    );
    mocks.createClient.mockResolvedValue(
      callbackClient({
        memberships: [
          { org_id: "org-member", role: "member" },
          { org_id: "org-owner", role: "owner" },
        ],
        rpc,
      }),
    );

    const response = await GET(
      new Request("https://www.moa-work.com/auth/callback?code=test-code"),
    );

    expect(response.headers.get("location")).toBe("https://www.moa-work.com/");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-owner");
    expect(rpc).toHaveBeenCalledWith("bootstrap_workspace", {
      p_org_id: "org-owner",
    });
  });

  it("일반 member 로그인에는 owner bootstrap RPC를 호출하지 않는다", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null });
    const supabase = callbackClient({
      memberships: [{ org_id: "org-member", role: "member" }],
      rpc,
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await GET(
      new Request("https://www.moa-work.com/auth/callback?code=test-code"),
    );

    expect(response.headers.get("location")).toBe("https://www.moa-work.com/");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("app_admin_role", {
      p_email: "member@example.com",
    });
  });

  it("bootstrap 오류를 provisioning 오류로 수렴시킨다", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "app_admin_role"
        ? { data: null, error: null }
        : { data: null, error: { message: "missing RPC", code: "42883" } },
    );
    mocks.createClient.mockResolvedValue(
      callbackClient({
        memberships: [{ org_id: "org-owner", role: "owner" }],
        rpc,
      }),
    );

    const response = await GET(
      new Request("https://www.moa-work.com/auth/callback?code=test-code"),
    );

    expect(response.headers.get("location")).toBe(
      "https://www.moa-work.com/login?error=provisioning",
    );
  });
});

function callbackClient({
  memberships,
  rpc,
}: {
  memberships: Array<{ org_id: string; role: string }>;
  rpc: ReturnType<typeof vi.fn>;
}) {
  const membershipEq = vi
    .fn()
    .mockResolvedValue({ data: memberships, error: null });
  return {
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "user-1",
            email: "member@example.com",
            user_metadata: { name: "Member" },
          },
        },
        error: null,
      }),
    },
    rpc,
    from: vi.fn((table: string) => {
      if (table === "users") {
        return { upsert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "org_members") {
        return { select: vi.fn(() => ({ eq: membershipEq })) };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}
