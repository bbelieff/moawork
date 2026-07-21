import { describe, it, expect } from "vitest";
import {
  deriveKey,
  uniqueKey,
  parseCreateFieldDef,
  parseUpdateFieldDef,
  parseCreateView,
  parseViewConfig,
  assertFilterOperators,
} from "./validation";
import { ValidationError } from "./field-types";

describe("validation: deriveKey/uniqueKey", () => {
  it("slugs ascii and korean labels", () => {
    expect(deriveKey("Deal Stage")).toBe("deal_stage");
    expect(deriveKey("진행 상태")).toBe("진행_상태");
    expect(deriveKey("A/B & C")).toBe("a_b_c");
  });
  it("throws when no letters/numbers", () => {
    expect(() => deriveKey("!!! ")).toThrow(ValidationError);
  });
  it("dedupes against existing and reserved keys", () => {
    expect(uniqueKey("Title", [])).toBe("title_2"); // reserved → suffixed
    expect(uniqueKey("Stage", ["stage"])).toBe("stage_2");
    expect(uniqueKey("Stage", ["stage", "stage_2"])).toBe("stage_3");
    expect(uniqueKey("Fresh", [])).toBe("fresh");
  });
});

describe("validation: parseCreateFieldDef", () => {
  it("accepts valid body", () => {
    const out = parseCreateFieldDef({ entity: "deal", label: "Score", type: "number" });
    expect(out).toEqual({ entity: "deal", label: "Score", type: "number" });
  });
  it("parses option labels", () => {
    const out = parseCreateFieldDef({
      entity: "company",
      label: "Tier",
      type: "select",
      optionLabels: ["gold", "silver"],
    });
    expect(out.optionLabels).toEqual(["gold", "silver"]);
  });
  it("rejects bad entity/type", () => {
    expect(() => parseCreateFieldDef({ entity: "x", label: "a", type: "text" })).toThrow(ValidationError);
    expect(() => parseCreateFieldDef({ entity: "deal", label: "a", type: "bogus" })).toThrow(ValidationError);
    expect(() => parseCreateFieldDef({ entity: "deal", label: "", type: "text" })).toThrow(ValidationError);
  });
});

describe("validation: parseUpdateFieldDef", () => {
  it("requires at least one field", () => {
    expect(() => parseUpdateFieldDef({})).toThrow(ValidationError);
    expect(parseUpdateFieldDef({ label: "New" })).toEqual({ label: "New" });
  });
});

describe("validation: view config", () => {
  it("parses filters/sorts/columns", () => {
    const cfg = parseViewConfig({
      filters: [{ fieldKey: "score", operator: "gt", value: 3 }],
      sorts: [{ fieldKey: "score", direction: "asc" }],
      columns: ["score", "title"],
    });
    expect(cfg.filters).toHaveLength(1);
    expect(cfg.sorts[0].direction).toBe("asc");
    expect(cfg.columns).toEqual(["score", "title"]);
  });
  it("rejects bad operator/direction", () => {
    expect(() => parseViewConfig({ filters: [{ fieldKey: "a", operator: "like" }] })).toThrow(ValidationError);
    expect(() => parseViewConfig({ sorts: [{ fieldKey: "a", direction: "up" }] })).toThrow(ValidationError);
  });
  it("parseCreateView reads name/entity/shared", () => {
    const v = parseCreateView({ entity: "deal", name: "My View", shared: true, config: {} });
    expect(v.entity).toBe("deal");
    expect(v.shared).toBe(true);
    expect(v.config).toEqual({ filters: [], sorts: [], columns: [] });
  });
});

describe("validation: assertFilterOperators", () => {
  it("rejects operator not allowed for field type", () => {
    const cfg = parseViewConfig({ filters: [{ fieldKey: "stage", operator: "gt", value: 1 }] });
    expect(() => assertFilterOperators(cfg, (k) => (k === "stage" ? "select" : undefined))).toThrow(
      ValidationError,
    );
  });
  it("passes when operator is allowed", () => {
    const cfg = parseViewConfig({ filters: [{ fieldKey: "amount", operator: "gt", value: 1 }] });
    expect(() => assertFilterOperators(cfg, () => "number")).not.toThrow();
  });
});
