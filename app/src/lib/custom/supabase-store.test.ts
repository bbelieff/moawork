import { describe, expect, it, vi } from "vitest";
import { SupabaseCustomStore } from "./supabase-store";

function clientReturning(data: unknown[]) {
  const calls: unknown[][] = [];
  const from = vi.fn((table: string) => {
    calls.push(["from", table]);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "delete", "eq"] as const) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push([method, ...args]);
        return builder;
      });
    }
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
    return builder;
  });
  return { calls, from, client: { from } };
}

describe("BBE-191 SupabaseCustomStore", () => {
  it("deletes only field_defs and never touches field_values", async () => {
    const fake = clientReturning([{ id: "field-a" }]);
    await expect(new SupabaseCustomStore(fake.client as never).deleteDef("org-a", "field-a"))
      .resolves.toBe(true);

    expect(fake.from).toHaveBeenCalledTimes(1);
    expect(fake.from).toHaveBeenCalledWith("field_defs");
    expect(fake.from).not.toHaveBeenCalledWith("field_values");
    expect(fake.calls).toContainEqual(["eq", "org_id", "org-a"]);
    expect(fake.calls).toContainEqual(["eq", "id", "field-a"]);
  });

  it("hosted value reload is scoped to organization and entity id", async () => {
    const fake = clientReturning([{ field_key: "memo", value_jsonb: "kept" }]);
    await expect(new SupabaseCustomStore(fake.client as never).getValues("org-a", "deal", "deal-a"))
      .resolves.toEqual({ memo: "kept" });

    expect(fake.calls).toContainEqual(["eq", "org_id", "org-a"]);
    expect(fake.calls).toContainEqual(["eq", "entity", "deal"]);
    expect(fake.calls).toContainEqual(["eq", "entity_id", "deal-a"]);
  });
});
