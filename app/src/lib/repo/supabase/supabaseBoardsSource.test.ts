import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import { NEWCUST_SOURCE, SupabaseBoardsSource } from "./supabaseBoardsSource";

type Call = { table: string; write?: unknown; filters: Record<string, unknown> };
type Result = { data: unknown; error: null | { message: string }; count?: number };

function database(resolve: (call: Call) => Result) {
  const calls: Call[] = [];
  class Query implements PromiseLike<Result> {
    private call: Call;
    constructor(table: string) { this.call = { table, filters: {} }; calls.push(this.call); }
    select() { return this; } insert(write: unknown) { this.call.write = write; return this; }
    update(write: unknown) { this.call.write = write; return this; } upsert(write: unknown) { this.call.write = write; return this; }
    delete() { this.call.write = "delete"; return this; } order() { return this; } limit() { return this; }
    in(key: string, value: unknown) { this.call.filters[key] = value; return this; }
    eq(key: string, value: unknown) { this.call.filters[key] = value; return this; }
    maybeSingle() { return Promise.resolve(resolve(this.call)); } single() { return Promise.resolve(resolve(this.call)); }
    then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) { return Promise.resolve(resolve(this.call)).then(onfulfilled, onrejected); }
  }
  return { db: { from: (table: string) => new Query(table) } as unknown as SupabaseClient, calls };
}

const ctx = { user: { id: "u1" }, org: { id: "00000000-0000-4000-8000-000000000001" } } as Ctx;

describe("SupabaseBoardsSource mutation boundaries", () => {
  it("allows the actual board creator to manage structure and rejects another member", async () => {
    const creator = database(() => ({ data: { created_by: "u1" }, error: null }));
    await expect(new SupabaseBoardsSource(creator.db).canManageStructure({ ...ctx, role: "member" }, "b1")).resolves.toBe(true);
    const nonOwner = database(() => ({ data: { created_by: "u2" }, error: null }));
    await expect(new SupabaseBoardsSource(nonOwner.db).canManageStructure({ ...ctx, role: "member" }, "b1")).resolves.toBe(false);
  });

  it("rejects a mutation when the target is not the newcust board", async () => {
    const fake = database((call) => call.table === "boards" ? { data: null, error: null } : { data: [], error: null });
    await expect(new SupabaseBoardsSource(fake.db).createItem(ctx, "other", "group", "업체")).rejects.toThrow("신규업체 보드");
    expect(fake.calls.map((call) => call.table)).toEqual(["boards"]);
    expect(fake.calls[0].filters.source).toBe(NEWCUST_SOURCE);
  });

  it("uses the authoritative DB column type before writing a cell", async () => {
    const fake = database((call) => {
      if (call.table === "boards") return { data: { id: "b1" }, error: null };
      if (call.table === "items") return { data: { id: "i1" }, error: null };
      if (call.table === "board_columns") return { data: { id: "c1", key: "amount", type: "number", options_jsonb: null }, error: null };
      return { data: null, error: null };
    });
    await new SupabaseBoardsSource(fake.db).setCell(ctx, "b1", "i1", "amount", "1200");
    const write = fake.calls.find((call) => call.table === "item_values")?.write as { value_jsonb: unknown };
    expect(write.value_jsonb).toBe(1200);
  });

  it("imports CSV rows in one atomic insert call", async () => {
    const fake = database((call) => {
      if (call.table === "boards") return { data: { id: "b1" }, error: null };
      if (call.table === "board_groups") return { data: { id: "g1" }, error: null };
      if (call.table === "items") return { data: [{ id: "i1" }, { id: "i2" }], error: null };
      return { data: null, error: null };
    });
    await expect(new SupabaseBoardsSource(fake.db).importItems(ctx, "b1", "g1", ["A", "B"])).resolves.toEqual(["i1", "i2"]);
    const writes = fake.calls.filter((call) => call.table === "items" && Array.isArray(call.write));
    expect(writes).toHaveLength(1);
    expect(writes[0].write).toHaveLength(2);
  });
});
