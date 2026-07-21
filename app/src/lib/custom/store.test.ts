import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCustomStore } from "./store";

function makeStore() {
  let n = 0;
  return new InMemoryCustomStore({ genId: () => `id-${++n}` });
}

const ORG = "org-1";
const OTHER = "org-2";

describe("store: field defs", () => {
  let store: InMemoryCustomStore;
  beforeEach(() => {
    store = makeStore();
  });

  it("creates with incrementing sort_order per entity", async () => {
    const a = await store.createDef(ORG, { entity: "deal", key: "a", label: "A", type: "text" });
    const b = await store.createDef(ORG, { entity: "deal", key: "b", label: "B", type: "number" });
    expect(a.sort_order).toBe(0);
    expect(b.sort_order).toBe(1);
    expect((await store.listDefs(ORG, "deal")).map((d) => d.key)).toEqual(["a", "b"]);
  });

  it("scopes by org (no cross-tenant leak)", async () => {
    await store.createDef(ORG, { entity: "deal", key: "a", label: "A", type: "text" });
    expect(await store.listDefs(OTHER)).toEqual([]);
    const def = await store.createDef(ORG, { entity: "deal", key: "b", label: "B", type: "text" });
    expect(await store.getDef(OTHER, def.id)).toBeNull();
  });

  it("reorders by ids, unlisted go last", async () => {
    const a = await store.createDef(ORG, { entity: "deal", key: "a", label: "A", type: "text" });
    const b = await store.createDef(ORG, { entity: "deal", key: "b", label: "B", type: "text" });
    const c = await store.createDef(ORG, { entity: "deal", key: "c", label: "C", type: "text" });
    await store.reorderDefs(ORG, "deal", [c.id, a.id]);
    expect((await store.listDefs(ORG, "deal")).map((d) => d.key)).toEqual(["c", "a", "b"]);
    expect(b.id).toBeTruthy();
  });
});

describe("store: values (PK entity_id+field_key)", () => {
  let store: InMemoryCustomStore;
  beforeEach(() => {
    store = makeStore();
  });

  it("upserts and reads per entity", async () => {
    await store.setValue(ORG, "deal-1", "a", "hello");
    await store.setValue(ORG, "deal-1", "b", 42);
    await store.setValue(ORG, "deal-2", "a", "other");
    expect(await store.getValues(ORG, "deal-1")).toEqual({ a: "hello", b: 42 });
    expect(await store.getValues(ORG, "deal-2")).toEqual({ a: "other" });
  });

  it("null deletes the cell", async () => {
    await store.setValue(ORG, "deal-1", "a", "hello");
    await store.setValue(ORG, "deal-1", "a", null);
    expect(await store.getValues(ORG, "deal-1")).toEqual({});
  });

  it("deleteDef prunes its values", async () => {
    const def = await store.createDef(ORG, { entity: "deal", key: "a", label: "A", type: "text" });
    await store.setValue(ORG, "deal-1", "a", "x");
    await store.setValue(ORG, "deal-1", "keep", "y");
    expect(await store.deleteDef(ORG, def.id)).toBe(true);
    expect(await store.getValues(ORG, "deal-1")).toEqual({ keep: "y" });
  });
});

describe("store: saved views visibility", () => {
  let store: InMemoryCustomStore;
  beforeEach(() => {
    store = makeStore();
  });

  it("lists my personal views ∪ shared views only", async () => {
    const base = { entity: "deal" as const, filters_jsonb: {}, sort_jsonb: [], columns_jsonb: [] };
    await store.createView(ORG, { ...base, userId: "u1", name: "mine", shared: false });
    await store.createView(ORG, { ...base, userId: "u2", name: "theirs", shared: false });
    await store.createView(ORG, { ...base, userId: "u2", name: "shared", shared: true });

    const forU1 = await store.listViews(ORG, "u1", "deal");
    expect(forU1.map((v) => v.name).sort()).toEqual(["mine", "shared"]);
  });

  it("updates and deletes", async () => {
    const v = await store.createView(ORG, {
      entity: "deal",
      userId: "u1",
      name: "v",
      filters_jsonb: {},
      sort_jsonb: [],
      columns_jsonb: [],
      shared: false,
    });
    const upd = await store.updateView(ORG, v.id, { name: "v2", shared: true });
    expect(upd?.name).toBe("v2");
    expect(upd?.shared).toBe(true);
    expect(await store.deleteView(ORG, v.id)).toBe(true);
    expect(await store.getView(ORG, v.id)).toBeNull();
  });
});
