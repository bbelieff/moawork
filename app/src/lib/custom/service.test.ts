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

describe("service: 값 정책 (기획2 판정 — 관대 + 인라인 피드백)", () => {
  it("유효값은 저장, 무효값은 저장하지 않고 errors 로 사유 반환", async () => {
    const { svc } = makeService();
    await svc.createField(ORG, { entity: "deal", label: "Score", type: "number" });
    await svc.createField(ORG, { entity: "deal", label: "Memo", type: "text" });

    const r = await svc.applyValues(ORG, "deal", "d1", { score: "abc", memo: "ok" });
    expect(r.ok).toBe(false);
    expect(r.errors.score).toBeTruthy(); // 사유 제공(인라인 피드백)
    expect(r.values.memo).toBe("ok"); // 유효값은 저장됨
    expect(r.values.score).toBeUndefined(); // ⛔ 조용한 null 수렴 없음 — 미저장
  });

  it("무효값이 기존 값을 덮어쓰지 않는다(데이터 유실 금지)", async () => {
    const { svc } = makeService();
    await svc.createField(ORG, { entity: "deal", label: "Score", type: "number" });
    await svc.applyValues(ORG, "deal", "d1", { score: 10 });
    const r = await svc.applyValues(ORG, "deal", "d1", { score: "abc" });
    expect(r.ok).toBe(false);
    expect(r.values.score).toBe(10); // 기존 값 보존
  });

  it("무결성 필드(fee_pct)는 예외 — 하드 거부(throw)", async () => {
    const { svc } = makeService();
    await svc.createField(ORG, { entity: "deal", key: "fee_pct", label: "수수료(%)", type: "number" });
    await expect(svc.applyValues(ORG, "deal", "d1", { fee_pct: "abc" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("전부 유효하면 ok=true", async () => {
    const { svc } = makeService();
    await svc.createField(ORG, { entity: "deal", label: "Score", type: "number" });
    const r = await svc.applyValues(ORG, "deal", "d1", { score: "42" });
    expect(r).toMatchObject({ ok: true, values: { score: 42 }, errors: {} });
  });
});

describe("service: 정본 key (한글 라벨을 조회 key 로 쓰지 않기)", () => {
  it("명시 key 를 그대로 사용 — 한글 라벨이어도 key 는 정본", async () => {
    const { svc } = makeService();
    const def = await svc.createField(ORG, {
      entity: "deal",
      key: "contract_status",
      label: "계약상황",
      type: "select",
      optionLabels: ["미작성", "작성완료"],
    });
    expect(def.key).toBe("contract_status"); // 라벨 파생("계약상황")이 아님
  });

  it("명시 key 중복은 거부 — 조용히 접미사 붙이지 않는다", async () => {
    const { svc } = makeService();
    await svc.createField(ORG, { entity: "deal", key: "region", label: "지역", type: "text" });
    await expect(
      svc.createField(ORG, { entity: "deal", key: "region", label: "지역2", type: "text" }),
    ).rejects.toBeInstanceOf(CustomFieldError);
  });
});

describe("service: deleted definition value visibility", () => {
  it("hides preserved values until the same key is recreated", async () => {
    const { store, svc } = makeService();
    const def = await svc.createField(ORG, {
      entity: "deal",
      key: "memo",
      label: "메모",
      type: "text",
    });
    await svc.applyValues(ORG, "deal", "deal-1", { memo: "kept" });

    await svc.deleteField(ORG, def.id);
    expect(await store.getValues(ORG, "deal", "deal-1")).toEqual({ memo: "kept" });
    expect(await svc.getValues(ORG, "deal", "deal-1")).toEqual({});

    await svc.createField(ORG, {
      entity: "deal",
      key: "memo",
      label: "메모 복구",
      type: "text",
    });
    expect(await svc.getValues(ORG, "deal", "deal-1")).toEqual({ memo: "kept" });
    await svc.createField(ORG, { entity: "company", key: "memo", label: "회사 메모", type: "text" });
    expect(await svc.getValues(ORG, "company", "deal-1")).toEqual({});
  });
});
