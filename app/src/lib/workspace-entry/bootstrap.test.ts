import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureDefaultTabs, repoClients } = vi.hoisted(() => ({
  ensureDefaultTabs: vi.fn(),
  repoClients: [] as unknown[],
}));

vi.mock("@/lib/default-tabs", () => ({ ensureDefaultTabs }));
vi.mock("@/lib/repo/supabase/boardsRepo", () => ({
  SupabaseBoardsRepo: class {
    constructor(client: unknown) { repoClients.push(client); }
  },
}));

import { bootstrapApprovedWorkspace } from "./bootstrap";

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => result,
  };
  return builder;
}

describe("bootstrapApprovedWorkspace", () => {
  beforeEach(() => {
    ensureDefaultTabs.mockReset().mockResolvedValue([]);
    repoClients.length = 0;
  });

  it("uses one authenticated client and includes the creator owner as an assignee", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: {
        id: "user-1", email: "owner@example.test", created_at: "2026-08-16T00:00:00Z",
        user_metadata: { name: "QA 생성자" },
      } } }) },
      from: (table: string) => table === "orgs"
        ? query({ data: { id: "org-1", name: "QA 회사", plan_tier: "free", created_at: "2026-08-16T00:00:00Z" }, error: null })
        : query({ data: { role: "owner", scope: "all", status: "active" }, error: null }),
    };
    await bootstrapApprovedWorkspace(client as never, "qa-company");
    expect(repoClients).toEqual([client]);
    expect(ensureDefaultTabs).toHaveBeenCalledOnce();
    expect(ensureDefaultTabs.mock.calls[0][0]).toMatchObject({
      user: { id: "user-1", name: "QA 생성자" },
      org: { id: "org-1", name: "QA 회사" },
      role: "owner",
      scope: "all",
    });
    expect(ensureDefaultTabs.mock.calls[0][2]).toEqual([{ userId: "user-1", displayName: "QA 생성자" }]);
  });

  it("fails closed when the request actor lacks an active membership", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1", created_at: "2026-08-16T00:00:00Z", user_metadata: {} } } }) },
      from: (table: string) => table === "orgs"
        ? query({ data: { id: "org-1", name: "QA 회사", plan_tier: "free", created_at: "2026-08-16T00:00:00Z" }, error: null })
        : query({ data: null, error: null }),
    };
    await expect(bootstrapApprovedWorkspace(client as never, "qa-company"))
      .rejects.toThrow("workspace bootstrap membership unavailable");
    expect(ensureDefaultTabs).not.toHaveBeenCalled();
  });
});
