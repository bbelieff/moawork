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
      rpc: vi.fn().mockResolvedValue({ data: "owner", error: null }),
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
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/");
    expect(orgInsert).toHaveBeenCalledTimes(1);
    expect(orgInsert).toHaveBeenCalledWith({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      name: "MoaWork 데모 조직",
    });
    expect(response.headers.get("set-cookie")).toContain("mw_org=");
  });
});
