import { describe, expect, it, vi } from "vitest";
import { LocalChecklistStore, SupabaseChecklistStore } from "./store";
import { db, resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";

const testStore = () => new LocalChecklistStore({ testOnly: true });

function client(rows: Record<string, unknown> = {}) {
  const calls: Array<[string, string, unknown]> = [];
  const query = (table: string) => {
    // Minimal fluent Supabase test double; its recursive surface is intentionally dynamic.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: (key: string, value: unknown) => { calls.push([table, key, value]); return chain; },
      order: async () => ({ data: rows[table] ?? [], error: null }),
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      upsert: async (value: unknown) => { calls.push([table, "upsert", value]); return { error: null }; },
    };
    return chain;
  };
  const rpc = vi.fn(async () => ({ data: [{ case_id: "deal-1", version: 1, replayed: false }], error: null }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sdk: { from: vi.fn(query), rpc } as any, calls, rpc };
}

describe("SupabaseChecklistStore", () => {
  it("binds deal reads and writes to org and survives a fresh adapter", async () => {
    const fake = client({ deal_document_checklists: { deal_id: "deal-1", product_id: "상품", items_jsonb: [{ id: "a", label: "서류", checked: true, order: 0 }] } });
    const first = new SupabaseChecklistStore(fake.sdk);
    await first.saveDealChecklist(
      "org-a",
      { caseId: "deal-1", dealId: "deal-1", productId: "상품", items: [], version: 0 },
      { requestId: "request-1", expectedVersion: 0 },
    );
    const reread = await new SupabaseChecklistStore(fake.sdk).getDealChecklist("org-a", "deal-1");
    expect(reread?.items[0].checked).toBe(true);
    expect(fake.calls).toContainEqual(["deal_document_checklists", "org_id", "org-a"]);
    expect(fake.calls).toContainEqual(["deal_document_checklists", "deal_id", "deal-1"]);
    expect(fake.rpc).toHaveBeenCalledWith("mutate_case_checklist", expect.objectContaining({
      p_case_id: "deal-1",
      p_request_id: "request-1",
      p_expected_version: 0,
    }));
  });
  it("keeps company presets org-scoped", async () => {
    const fake = client();
    await new SupabaseChecklistStore(fake.sdk).getPreset("org-b", "상품");
    expect(fake.calls).toContainEqual(["policyfund_checklist_presets", "org_id", "org-b"]);
  });

  it("rejects conflicting caseId/dealId aliases before calling the canonical RPC", async () => {
    const fake = client();
    await expect(new SupabaseChecklistStore(fake.sdk).saveDealChecklist("org-a", {
      caseId: "case-a", dealId: "case-b", productId: null, items: [], version: 0,
    }, { requestId: "request-alias", expectedVersion: 0 })).rejects.toThrow(/alias mismatch/);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed product ids before calling the canonical RPC", async () => {
    for (const productId of [1, {}, []]) {
      const fake = client();
      await expect(new SupabaseChecklistStore(fake.sdk).saveDealChecklist("org-a", {
        caseId: "deal-1", dealId: "deal-1", productId: productId as never, items: [], version: 0,
      }, { requestId: crypto.randomUUID(), expectedVersion: 0 })).rejects.toThrow(/schema invalid/);
      expect(fake.rpc).not.toHaveBeenCalled();
    }
  });
});

describe("LocalChecklistStore parity", () => {
  it("persists across adapters and enforces exact replay, mismatch, and CAS", async () => {
    const org = crypto.randomUUID();
    const dealId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const state = {
      caseId: dealId, dealId, productId: "상품",
      items: [{ id: "doc-1", label: "서류", checked: false, order: 0 }], version: 0,
    };
    const first = await testStore().saveDealChecklist(org, state, { requestId, expectedVersion: 0 });
    const reorderedKeys = {
      ...state,
      items: state.items.map((item) => ({ checked: item.checked, order: item.order, label: item.label, id: item.id })),
    };
    await expect(testStore().saveDealChecklist(org, reorderedKeys, { requestId, expectedVersion: 0 })).resolves.toEqual(first);
    await expect(testStore().saveDealChecklist(org, { ...state, productId: "changed" }, { requestId, expectedVersion: 0 })).rejects.toThrow(/mismatch/);
    await expect(testStore().saveDealChecklist(org, state, { requestId: crypto.randomUUID(), expectedVersion: 0 })).rejects.toThrow(/conflict/);
    expect((await testStore().getDealChecklist(org, dealId))?.version).toBe(1);
    await expect(testStore().saveDealChecklist(org, reorderedKeys, {
      requestId: crypto.randomUUID(), expectedVersion: 1,
    })).resolves.toMatchObject({ version: 1 });
  });

  it("records a new no-op request without inventing a row or version and matches SQL semantics", async () => {
    const org = crypto.randomUUID();
    const dealId = crypto.randomUUID();
    const store = testStore();
    const state = { caseId: dealId, dealId, productId: null, items: [], version: 0 };
    const result = await store.saveDealChecklist(org, state, { requestId: crypto.randomUUID(), expectedVersion: 0 });
    expect(result.version).toBe(0);
    expect(await store.getDealChecklist(org, dealId)).toBeNull();
  });

  it("rejects conflicting aliases before authorization or persistence", async () => {
    const org = crypto.randomUUID();
    const store = testStore();
    await expect(store.saveDealChecklist(org, {
      caseId: "case-a", dealId: "case-b", productId: null, items: [], version: 0,
    }, { requestId: crypto.randomUUID(), expectedVersion: 0 })).rejects.toThrow(/alias mismatch/);
    expect(await store.getDealChecklist(org, "case-a")).toBeNull();
    expect(await store.getDealChecklist(org, "case-b")).toBeNull();
  });

  it("rejects malformed durable items before row or receipt mutation", async () => {
    const org = crypto.randomUUID();
    const dealId = crypto.randomUUID();
    const store = testStore();
    const malformed = {
      caseId: dealId,
      dealId,
      productId: null,
      items: [{ id: "duplicate", label: "서류", checked: true, order: 0 }, { id: "duplicate", label: "다른 서류", checked: false, order: 1 }],
      version: 0,
    };
    await expect(store.saveDealChecklist(org, malformed, { requestId: crypto.randomUUID(), expectedVersion: 0 })).rejects.toThrow(/schema invalid/);
    expect(await store.getDealChecklist(org, dealId)).toBeNull();
  });

  it("classifies null and non-object checklist entries as schema invalid", async () => {
    const org = crypto.randomUUID();
    const dealId = crypto.randomUUID();
    const store = testStore();
    for (const item of [null, "not-an-object", []]) {
      await expect(store.saveDealChecklist(org, {
        caseId: dealId, dealId, productId: null, items: [item] as never, version: 0,
      }, { requestId: crypto.randomUUID(), expectedVersion: 0 })).rejects.toThrow(/schema invalid/);
    }
    expect(await store.getDealChecklist(org, dealId)).toBeNull();
  });

  it("accepts only string product ids or explicit null clear", async () => {
    const org = crypto.randomUUID();
    const dealId = crypto.randomUUID();
    const store = testStore();
    for (const productId of [1, {}, []]) {
      await expect(store.saveDealChecklist(org, {
        caseId: dealId, dealId, productId: productId as never, items: [], version: 0,
      }, { requestId: crypto.randomUUID(), expectedVersion: 0 })).rejects.toThrow(/schema invalid/);
    }
    await expect(store.saveDealChecklist(org, {
      caseId: dealId, dealId, productId: null, items: [], version: 0,
    }, { requestId: crypto.randomUUID(), expectedVersion: 0 })).resolves.toMatchObject({ productId: null });
    expect(await store.getDealChecklist(org, dealId)).toBeNull();
  });

  it("inherits the Local Case visibility and exact active projection boundary", async () => {
    resetDb();
    const seeded = db();
    const deal = seeded.deals[0];
    const owner = seeded.users[0];
    const ctx: Ctx = { user: owner, org: seeded.orgs[0], role: "owner", scope: "all" };
    const projection = {
      id: crypto.randomUUID(), org_id: ctx.org.id, board_id: seeded.boards[0].id,
      group_id: null, title: deal.title, assigned_to: deal.assigned_to, deal_id: deal.id,
      sort_order: 0, deleted_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    seeded.boardItems.push(projection);
    const state = {
      caseId: deal.id, dealId: deal.id, productId: null,
      items: [{ id: "doc-1", label: "서류", checked: false, order: 0 }], version: 0,
    };
    await expect(new LocalChecklistStore(ctx).saveDealChecklist(ctx.org.id, state, {
      requestId: crypto.randomUUID(), expectedVersion: 0,
    })).resolves.toMatchObject({ version: 1 });
    const foreignCtx = { ...ctx, org: { ...ctx.org, id: crypto.randomUUID() } };
    await expect(new LocalChecklistStore(foreignCtx).saveDealChecklist(ctx.org.id, state, {
      requestId: crypto.randomUUID(), expectedVersion: 1,
    })).rejects.toThrow(/unavailable/);
    seeded.boardItems.splice(seeded.boardItems.indexOf(projection), 1);
    await expect(new LocalChecklistStore(ctx).saveDealChecklist(ctx.org.id, state, {
      requestId: crypto.randomUUID(), expectedVersion: 1,
    })).rejects.toThrow(/unavailable/);
  });
});
