import { describe, expect, it, vi } from "vitest";
import { SupabaseChecklistStore } from "./store";

function client(rows: Record<string, unknown> = {}) {
  const calls: Array<[string, string, unknown]> = [];
  const query = (table: string) => {
    // Minimal fluent Supabase test double; its recursive surface is intentionally dynamic.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: (key: string, value: unknown) => { calls.push([table, key, value]); return chain; },
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      upsert: async (value: unknown) => { calls.push([table, "upsert", value]); return { error: null }; },
    };
    return chain;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sdk: { from: vi.fn(query) } as any, calls };
}

describe("SupabaseChecklistStore", () => {
  it("binds deal reads and writes to org and survives a fresh adapter", async () => {
    const fake = client({ deal_document_checklists: { deal_id: "deal-1", product_id: "상품", items_jsonb: [{ id: "a", label: "서류", checked: true, order: 0 }] } });
    const first = new SupabaseChecklistStore(fake.sdk);
    await first.saveDealChecklist("org-a", { dealId: "deal-1", productId: "상품", items: [] });
    const reread = await new SupabaseChecklistStore(fake.sdk).getDealChecklist("org-a", "deal-1");
    expect(reread?.items[0].checked).toBe(true);
    expect(fake.calls).toContainEqual(["deal_document_checklists", "org_id", "org-a"]);
    expect(fake.calls).toContainEqual(["deal_document_checklists", "deal_id", "deal-1"]);
  });
  it("keeps company presets org-scoped", async () => {
    const fake = client();
    await new SupabaseChecklistStore(fake.sdk).getPreset("org-b", "상품");
    expect(fake.calls).toContainEqual(["policyfund_checklist_presets", "org_id", "org-b"]);
  });
});
