import { beforeEach, describe, expect, it, vi } from "vitest";

const { session, permission, audit, requestClient, cachedSource } = vi.hoisted(() => ({
  session: vi.fn(), permission: vi.fn(), audit: vi.fn(), requestClient: vi.fn(),
  cachedSource: vi.fn(() => { throw new Error("Request actions must not use the cached anonymous source"); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: session }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: permission }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: audit }));
vi.mock("@/lib/supabase/server", () => ({ createClient: requestClient }));
vi.mock("@/lib/repo/supabase", () => ({ getCrmSource: cachedSource }));

import { bulkUpdateCompaniesAction, bulkUpdateDealsAction } from "./bulk-actions";

// Keep the actual AsyncCrmService + SupabaseCrmSource. Only replace the HTTP
// client boundary, so tenant predicates, row scope, and read-before-write run.
function clientFor(orgId: string, assignedTo = "actor") {
  const rows = [
    { id: "own", org_id: orgId, assigned_to: assignedTo, name: "Synthetic", title: "Synthetic" },
    { id: "foreign", org_id: "other-org", assigned_to: "other", name: "Other synthetic", title: "Other synthetic" },
  ];
  const writes: Array<{ table: string; id: string; patch: Record<string, unknown> }> = [];
  const reads: Array<Record<string, unknown>> = [];
  return {
    writes, reads,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | undefined;
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        update(value: Record<string, unknown>) { patch = value; return query; },
        async maybeSingle() {
          reads.push({ table, ...filters });
          const row = rows.find(r => Object.entries(filters).every(([key, value]) => r[key as keyof typeof r] === value));
          if (row && patch) writes.push({ table, id: row.id, patch });
          return { error: null, data: row ? { ...row, ...patch } : null };
        },
      };
      return query;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ org: { id: "org-one" }, user: { id: "actor" }, role: "owner", scope: "all" });
  permission.mockResolvedValue({ kind: "allowed" });
  audit.mockResolvedValue({ ok: true });
});

const cases = [
  { table: "companies", field: "biz_type", run: (ids: string[]) => bulkUpdateCompaniesAction({ companyIds: ids, field: "biz_type", value: "Synthetic manufacturing" }) },
  { table: "deals", field: "title", run: (ids: string[]) => bulkUpdateDealsAction({ dealIds: ids, field: "title", value: "Synthetic work" }) },
];

describe.each(cases)("$table request authentication", ({ table, field, run }) => {
  it("uses a fresh authenticated request client and keeps tenant/field predicates", async () => {
    const first = clientFor("org-one");
    const second = clientFor("org-two");
    requestClient.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    expect((await run(["own", "foreign"])).applied).toBe(1);
    session.mockResolvedValueOnce({ org: { id: "org-two" }, user: { id: "actor" }, role: "owner", scope: "all" });
    expect((await run(["own"])).ok).toBe(true);
    expect(requestClient).toHaveBeenCalledTimes(2);
    expect(cachedSource).not.toHaveBeenCalled();
    for (const [client, org] of [[first, "org-one"], [second, "org-two"]] as const) {
      expect(client.writes).toHaveLength(1);
      expect(client.writes[0]).toMatchObject({ table, id: "own" });
      expect(Object.keys(client.writes[0].patch).sort()).toEqual(table === "deals" ? [field, "updated_at"].sort() : [field]);
      expect(client.reads.every(read => read.org_id === org)).toBe(true);
    }
  });

  it("denied bulk permission does not create a client or write", async () => {
    permission.mockResolvedValueOnce({ kind: "denied", reason: "permission" });
    expect((await run(["own"])).failed).toBe(1);
    expect(requestClient).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("same-tenant out-of-scope rows remain unwritable", async () => {
    const client = clientFor("org-one", "other");
    requestClient.mockResolvedValueOnce(client);
    session.mockResolvedValueOnce({ org: { id: "org-one" }, user: { id: "actor" }, role: "member", scope: "own" });
    expect((await run(["own"])).failed).toBe(1);
    expect(client.writes).toEqual([]);
  });

  it("request client failure returns failure without anonymous fallback", async () => {
    requestClient.mockRejectedValueOnce(new Error("cookies unavailable"));
    expect((await run(["own"])).failed).toBe(1);
    expect(cachedSource).not.toHaveBeenCalled();
  });
});
