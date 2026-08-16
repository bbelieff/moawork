import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureDefaultTabs, repoClients, loadMemberOrgSummaryWithClient } = vi.hoisted(() => ({
  ensureDefaultTabs: vi.fn(),
  repoClients: [] as unknown[],
  loadMemberOrgSummaryWithClient: vi.fn(),
}));

vi.mock("@/lib/default-tabs", () => ({
  ensureDefaultTabs,
  DEFAULT_TABS: ["new-lead", "contact", "contract-work", "notice"].map((key) => ({ source: `core.default-tab/${key}` })),
}));
vi.mock("@/lib/repo/supabase/boardsRepo", () => ({
  SupabaseBoardsRepo: class {
    constructor(client: unknown) { repoClients.push(client); }
    async listBoards() { return []; }
  },
}));
vi.mock("@/lib/auth/member-org-summary", () => ({ loadMemberOrgSummaryWithClient }));

import { bootstrapApprovedWorkspace, ensureApprovedWorkspaceOnEntry } from "./bootstrap";

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    limit: () => builder,
    maybeSingle: async () => result,
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

const leaseRpc = async () => ({ data: true, error: null });

describe("bootstrapApprovedWorkspace", () => {
  beforeEach(() => {
    ensureDefaultTabs.mockReset().mockResolvedValue([]);
    repoClients.length = 0;
    loadMemberOrgSummaryWithClient.mockResolvedValue({
      kind: "ready",
      owner: { userId: "user-1", displayName: "QA 생성자" },
      admins: [],
      members: [],
    });
  });

  it("uses one authenticated client and includes the creator owner as an assignee", async () => {
    const client = {
      rpc: leaseRpc,
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

  it("passes every active member from the same request client to reconciliation", async () => {
    loadMemberOrgSummaryWithClient.mockResolvedValue({
      kind: "ready",
      owner: { userId: "user-1", displayName: "Owner" },
      admins: [{ userId: "user-2", displayName: "Admin" }],
      members: [{ userId: "user-3", displayName: "Member" }],
    });
    const client = {
      rpc: leaseRpc,
      auth: { getUser: async () => ({ data: { user: { id: "user-1", created_at: "2026-08-16", user_metadata: {} } } }) },
      from: (table: string) => table === "orgs"
        ? query({ data: { id: "org-1", name: "QA", plan_tier: "free", created_at: "2026-08-16" }, error: null })
        : query({ data: { role: "owner", scope: "all", status: "active" }, error: null }),
    };
    await bootstrapApprovedWorkspace(client as never, "qa-company");
    expect(loadMemberOrgSummaryWithClient).toHaveBeenCalledWith(client, expect.objectContaining({ org: { id: "org-1", name: "QA", plan_tier: "free", created_at: "2026-08-16" } }));
    expect(ensureDefaultTabs.mock.calls[0][2]).toEqual([
      { userId: "user-1", displayName: "Owner" },
      { userId: "user-2", displayName: "Admin" },
      { userId: "user-3", displayName: "Member" },
    ]);
  });

  it("fails closed when the request actor lacks an active membership", async () => {
    const client = {
      rpc: leaseRpc,
      auth: { getUser: async () => ({ data: { user: { id: "user-1", created_at: "2026-08-16T00:00:00Z", user_metadata: {} } } }) },
      from: (table: string) => table === "orgs"
        ? query({ data: { id: "org-1", name: "QA 회사", plan_tier: "free", created_at: "2026-08-16T00:00:00Z" }, error: null })
        : query({ data: null, error: null }),
    };
    await expect(bootstrapApprovedWorkspace(client as never, "qa-company"))
      .rejects.toThrow("workspace bootstrap membership unavailable");
    expect(ensureDefaultTabs).not.toHaveBeenCalled();
  });

  it("reconciles an approved create request again on reload without trusting board shells", async () => {
    let installed = false;
    ensureDefaultTabs.mockImplementation(async () => { installed = true; return []; });
    const client = {
      rpc: async (name: string) => name === "is_my_approved_workspace_creator"
        ? { data: true, error: null }
        : leaseRpc(),
      auth: { getUser: async () => ({ data: { user: {
        id: "user-1", email: "owner@example.test", created_at: "2026-08-16T00:00:00Z", user_metadata: { name: "Owner" },
      } } }) },
      from: (table: string) => {
        if (table === "orgs") return query({ data: { id: "org-1", name: "QA", plan_tier: "free", created_at: "2026-08-16T00:00:00Z" }, error: null });
        if (table === "org_members") return query({ data: { role: "owner", scope: "all", status: "active" }, error: null });
        if (table === "boards") return query({
          data: installed
            ? ["new-lead", "contact", "contract-work", "notice"].map((key) => ({ source: `core.default-tab/${key}` }))
            : [],
          error: null,
        });
        throw new Error(`unexpected table ${table}`);
      },
    };
    await ensureApprovedWorkspaceOnEntry(client as never, "qa-company");
    expect(ensureDefaultTabs).toHaveBeenCalledOnce();
    await ensureApprovedWorkspaceOnEntry(client as never, "qa-company");
    expect(ensureDefaultTabs).toHaveBeenCalledTimes(2);
  });

  it("does not backfill a legacy workspace without its creator's approved request", async () => {
    const client = {
      rpc: async (name: string) => name === "is_my_approved_workspace_creator"
        ? { data: false, error: null }
        : leaseRpc(),
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        if (table === "orgs") return query({ data: { id: "org-1" }, error: null });
        if (table === "boards") return query({ data: [], error: null });
        throw new Error(`unexpected table ${table}`);
      },
    };
    await ensureApprovedWorkspaceOnEntry(client as never, "legacy-company");
    expect(ensureDefaultTabs).not.toHaveBeenCalled();
  });

  it("serializes two concurrent reconciliations through the database lease", async () => {
    let activeHolder: string | null = null;
    let activeEnsures = 0;
    let maxActiveEnsures = 0;
    ensureDefaultTabs.mockImplementation(async () => {
      activeEnsures += 1;
      maxActiveEnsures = Math.max(maxActiveEnsures, activeEnsures);
      await new Promise((resolve) => setTimeout(resolve, 40));
      activeEnsures -= 1;
      return [];
    });
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1", created_at: "2026-08-16", user_metadata: {} } } }) },
      rpc: async (name: string, args: { p_holder: string }) => {
        if (name === "acquire_workspace_bootstrap_lease") {
          if (activeHolder === null || activeHolder === args.p_holder) {
            activeHolder = args.p_holder;
            return { data: true, error: null };
          }
          return { data: false, error: null };
        }
        if (name === "renew_workspace_bootstrap_lease") {
          return { data: activeHolder === args.p_holder, error: null };
        }
        if (activeHolder === args.p_holder) activeHolder = null;
        return { data: true, error: null };
      },
      from: (table: string) => table === "orgs"
        ? query({ data: { id: "org-1", name: "QA", plan_tier: "free", created_at: "2026-08-16" }, error: null })
        : query({ data: { role: "owner", scope: "all", status: "active" }, error: null }),
    };

    await Promise.all([
      bootstrapApprovedWorkspace(client as never, "qa-company"),
      bootstrapApprovedWorkspace(client as never, "qa-company"),
    ]);

    expect(ensureDefaultTabs).toHaveBeenCalledTimes(2);
    expect(maxActiveEnsures).toBe(1);
    expect(activeHolder).toBeNull();
  });

  it("aborts before the next repository operation when the lease is lost", async () => {
    let renewals = 0;
    ensureDefaultTabs.mockImplementation(async (_ctx, repo) => repo.listBoards({}));
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1", created_at: "2026-08-16", user_metadata: {} } } }) },
      rpc: async (name: string) => {
        if (name === "acquire_workspace_bootstrap_lease") return { data: true, error: null };
        if (name === "renew_workspace_bootstrap_lease") {
          renewals += 1;
          return { data: renewals === 1, error: null };
        }
        return { data: false, error: null };
      },
      from: (table: string) => table === "orgs"
        ? query({ data: { id: "org-1", name: "QA", plan_tier: "free", created_at: "2026-08-16" }, error: null })
        : query({ data: { role: "owner", scope: "all", status: "active" }, error: null }),
    };

    await expect(bootstrapApprovedWorkspace(client as never, "qa-company"))
      .rejects.toThrow("workspace bootstrap lease lost");
    expect(renewals).toBe(2);
  });
});
