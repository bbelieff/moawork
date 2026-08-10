import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/supabase/env", () => ({ hasSupabaseEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { applyAs, getSessionOrNull } from "./session";

const source = readFileSync(new URL("./session.ts", import.meta.url), "utf8");

function membership(
  orgId: string,
  slug: string,
  role: "owner" | "admin" | "member" = "member",
  memberStatus = "active",
) {
  return {
    org_id: orgId,
    status: memberStatus,
    role,
    scope: role === "member" ? "assigned" : "all",
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

function setup({
  rows = [membership("org-1", "alpha-team")],
  preferredOrgId,
  platformRole = null,
  membershipError = null,
}: {
  rows?: unknown[];
  preferredOrgId?: string;
  platformRole?: unknown;
  membershipError?: unknown;
} = {}) {
  const order = vi.fn().mockResolvedValue({
    data: rows,
    error: membershipError,
  });
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "user-1",
            email: "platform@example.test",
            created_at: "2026-01-01T00:00:00.000Z",
            user_metadata: { name: "구성원" },
          },
        },
        error: null,
      }),
    },
    from: vi.fn(() => ({ select })),
    rpc: vi.fn().mockResolvedValue({ data: platformRole, error: null }),
  };
  mocks.createClient.mockResolvedValue(supabase);
  mocks.cookies.mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "mw_org" && preferredOrgId
        ? { value: preferredOrgId }
        : name === "mw_as"
          ? { value: "owner" }
          : undefined,
    ),
  });
  return supabase;
}

const memberContext: Ctx = {
  user: {
    id: "user-1",
    email: null,
    name: "구성원",
    avatar_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  org: {
    id: "org-1",
    name: "테스트 회사",
    plan_tier: "t1_3",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  role: "member",
  scope: "assigned",
  isPlatformAdmin: false,
};

describe("workspace session authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["owner", "admin", "member", "unexpected", null])(
    "query/cookie override %s cannot change membership authority",
    (candidate) => {
      expect(applyAs(memberContext, candidate)).toEqual(memberContext);
    },
  );

  it("keeps platform identity separate from tenant membership authority", async () => {
    setup({ platformRole: "owner" });

    const ctx = await getSessionOrNull();

    expect(ctx).toMatchObject({
      role: "member",
      scope: "assigned",
      isPlatformAdmin: true,
      org: { id: "org-1" },
    });
  });

  it("requires an exact active membership for a preferred workspace cookie", async () => {
    setup({ preferredOrgId: "stale-org" });
    await expect(getSessionOrNull()).resolves.toBeNull();
  });

  it("does not select a convenient first workspace when two are active", async () => {
    setup({
      rows: [
        membership("org-1", "alpha-team", "owner"),
        membership("org-2", "beta-team"),
      ],
    });
    await expect(getSessionOrNull()).resolves.toBeNull();
  });

  it("selects the exact verified membership among multiple active workspaces", async () => {
    setup({
      preferredOrgId: "org-2",
      rows: [
        membership("org-1", "alpha-team", "owner"),
        membership("org-2", "beta-team"),
      ],
    });

    const ctx = await getSessionOrNull();

    expect(ctx).toMatchObject({
      role: "member",
      scope: "assigned",
      org: { id: "org-2" },
    });
  });

  it("fails closed for inactive, malformed, or failed membership reads", async () => {
    setup({ rows: [membership("org-1", "alpha-team", "member", "suspended")] });
    await expect(getSessionOrNull()).resolves.toBeNull();

    setup({ rows: [{ org_id: "org-1", status: "active", orgs: null }] });
    await expect(getSessionOrNull()).resolves.toBeNull();

    setup({ membershipError: new Error("membership unavailable") });
    await expect(getSessionOrNull()).resolves.toBeNull();
  });

  it("contains no legacy fallback or cookie-based role grant path", () => {
    expect(source).toContain("chooseSessionMembership(membershipRows, preferredOrgId)");
    expect(source).toContain("role: membership.role");
    expect(source).toContain("scope: membership.scope");
    expect(source).not.toContain("jar.get(SESSION_COOKIE.as)");
    expect(source).not.toContain("platformRole ?? membership.role");
    expect(source).not.toContain("adminGrantFromFallback");
  });
});
