import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { proxy } from "./proxy";

function membership(orgId: string, slug: string) {
  return { org_id: orgId, status: "active", role: "member", scope: "assigned", created_at: "2026-01-01T00:00:00Z", orgs: { id: orgId, slug, status: "active", name: "샘플", plan_tier: "t1_3", created_at: "2026-01-01T00:00:00Z" } };
}

function setup(user: { id: string } | null, rows: unknown[] = []) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  mocks.createServerClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, from: vi.fn(() => ({ select })) });
}

describe("proxy workspace namespace", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-test-key";
    mocks.createServerClient.mockReset();
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("injects selected mw_org into the same rewritten request for a 2+ exact target", async () => {
    setup({ id: "user-1" }, [membership("org-alpha", "alpha-team"), membership("org-acme", "acme")]);
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/acme/deals/123?tab=notes"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://www.moa-work.com/deals/123?tab=notes");
    expect(response.headers.get("x-middleware-request-cookie")).toContain("mw_org=org-acme");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-acme");
  });

  it("canonicalizes an unauthenticated alias in login next without opening reserved routes", async () => {
    setup(null);
    const response = await proxy(new NextRequest("https://www.moa-work.com/acme?tab=notes"));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/login?next=%2Fw%2Facme%3Ftab%3Dnotes");
    const reserved = await proxy(new NextRequest("https://www.moa-work.com/settings"));
    expect(reserved.headers.get("location")).toBe("https://www.moa-work.com/login?next=%2Fsettings");
  });

  it("canonicalizes legacy protected root links to the verified workspace", async () => {
    setup({ id: "user-1" }, [membership("org-acme", "acme")]);
    const namespaced = await proxy(new NextRequest("https://www.moa-work.com/w/acme/notices"));
    expect(namespaced.headers.get("set-cookie")).toContain("mw_workspace_slug=acme");

    const request = new NextRequest("https://www.moa-work.com/boards/board-1?view=table", {
      headers: { cookie: "mw_workspace_slug=acme; mw_org=org-acme" },
    });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/w/acme/boards/board-1?view=table");

    const settings = await proxy(new NextRequest("https://www.moa-work.com/settings/account", {
      headers: { cookie: "mw_workspace_slug=acme; mw_org=org-acme" },
    }));
    expect(settings.headers.get("location")).toBe("https://www.moa-work.com/w/acme/settings/account");
  });

  it("fails closed for a protected root link without a verified workspace slug", async () => {
    setup({ id: "user-1" }, [membership("org-acme", "acme")]);
    const response = await proxy(new NextRequest("https://www.moa-work.com/notices"));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/workspace-entry?error=routing");
  });
});
