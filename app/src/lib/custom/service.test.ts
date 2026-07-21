import { describe, it, expect } from "vitest";
import { InMemoryCustomStore } from "./store";
import { CustomService, CustomFieldError } from "./service";
import { ValidationError } from "./field-types";

const ORG = "org-1";

function makeService() {
  let n = 0;
  const gen = () => `id-${++n}`;
  const store = new InMemoryCustomStore({ genId: gen });
  let m = 0;
  const optGen = () => `opt-${++m}`;
  return { store, svc: new CustomService(store, optGen) };
}

describe("service: createField", () => {
  it("derives a Korean key from a Korean label (한국어 라벨 지원)", async () => {
    const { svc } = makeService();
    const def = await svc.createField(ORG, {
      entity: "deal",
      label: "진행 상태",
      type: "select",
      optionLabels: ["상담중", "완료"],
    });
    expect(def.key).toBe("진행_상태");
    expect(def.options_jsonb?.options.map((o) => o.label)).toEqual(["상담중", "완료"]);
  });

  it("derives ascii key and dedupes on collision", async () => {
    const { svc } = makeService();
    const a = await svc.createField(ORG, { entity: "deal", label: "Deal Stage", type: "text" });
    const b = await svc.createField(ORG, { entity: "deal", label: "Deal  Stage", type: "text" });
    expect(a.key).toBe("deal_stage");
    expect(b.key).toBe("deal_stage_2");
  });

  it("issues opaque option ids for select", async () => {
    const { svc } = makeService();
    const def = await svc.createField(ORG, {
      entity: "deal",
      label: "Priority",
      type: "select",
      optionLabels: ["Low", "High"],
    });
    expect(def.options_jsonb?.options.map((o) => o.id)).toEqual(["opt-1", "opt-2"]);
    expect(def.options_jsonb?.options.map((o) => o.label)).toEqual(["Low", "High"]);
  });

  it("rejects options on non-option type", async () => {
    const { svc } = makeService();
    await expect(
      svc.createField(ORG, { entity: "deal", label: "N", type: "number", optionLabels: ["x"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("service: setValues normalization", () => {
  it("normalizes each value by its field type; ignores unknown keys", async () => {
    const { svc } = makeService();
    await svc.createField(ORG, { entity: "deal", label: "Score", type: "number" });
    await svc.createField(ORG, { entity: "deal", label: "Email", type: "email" });

    const result = await svc.setValues(ORG, "deal", "deal-1", {
      score: "42",
      email: "A@B.com",
      unknown_key: "ignored",
    });
    expect(result).toEqual({ score: 42, email: "a@b.com" });
  });

  it("validates select against issued option ids", async () => {
    const { svc } = makeService();
    const def = await svc.createField(ORG, {
      entity: "deal",
      label: "Priority",
      type: "select",
      optionLabels: ["A", "B"],
    });
    const key = def.key; // "priority"
    const okId = def.options_jsonb!.options[0].id;
    const res = await svc.setValues(ORG, "deal", "deal-1", { [key]: okId });
    expect(res).toEqual({ [key]: okId });
    await expect(svc.setValues(ORG, "deal", "deal-1", { [key]: "bogus" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("service: module_key preset lock", () => {
  it("blocks option edit and delete on preset fields", async () => {
    const { svc, store } = makeService();
    const def = await svc.createField(ORG, {
      entity: "deal",
      label: "Region",
      type: "select",
      optionLabels: ["Seoul"],
      moduleKey: "ind.policyfund",
    });
    await expect(svc.setOptions(ORG, def.id, [])).rejects.toBeInstanceOf(CustomFieldError);
    await expect(svc.deleteField(ORG, def.id)).rejects.toBeInstanceOf(CustomFieldError);
    // still present
    expect(await store.getDef(ORG, def.id)).not.toBeNull();
  });

  it("allows option edit on normal fields", async () => {
    const { svc } = makeService();
    const def = await svc.createField(ORG, { entity: "deal", label: "P", type: "select", optionLabels: ["a"] });
    const updated = await svc.setOptions(ORG, def.id, [
      { id: "opt-1", label: "renamed", order: 0 },
    ]);
    expect(updated.options_jsonb?.options[0].label).toBe("renamed");
  });
});

describe("service: saved views", () => {
  it("creates, applies config roundtrip, deletes", async () => {
    const { svc } = makeService();
    const view = await svc.createView(ORG, "u1", {
      entity: "deal",
      name: "hot",
      shared: false,
      config: {
        filters: [{ fieldKey: "score", operator: "gt", value: 50 }],
        sorts: [{ fieldKey: "score", direction: "desc" }],
        columns: ["score"],
      },
    });
    expect(svc.viewConfigOf(view).filters[0].value).toBe(50);
    const upd = await svc.updateView(ORG, view.id, { name: "hotter", shared: true });
    expect(upd?.name).toBe("hotter");
    expect(upd?.shared).toBe(true);
    expect(await svc.deleteView(ORG, view.id)).toBe(true);
  });
});
