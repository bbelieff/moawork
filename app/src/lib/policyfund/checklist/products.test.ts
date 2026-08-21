import { describe, expect, it } from "vitest";
import { CHECKLIST_PRODUCT_CATEGORY, CHECKLIST_PRODUCT_LABELS } from "./products";

describe("CHECKLIST_PRODUCT_LABELS", () => {
  it("BBE-261 결정에 따라 앱 업무관리의 59종 정본을 그대로 쓴다", () => {
    expect(CHECKLIST_PRODUCT_LABELS).toHaveLength(59);
    expect(CHECKLIST_PRODUCT_LABELS[0]).toBe("개발기술사업화");
    expect(CHECKLIST_PRODUCT_LABELS.at(-1)).toBe("일시적경영애로");
  });
});

describe("CHECKLIST_PRODUCT_CATEGORY", () => {
  it("ChecklistPanel/ProductChecklistAdmin 이 바로 쓸 수 있는 OptionCategory 형태다", () => {
    expect(CHECKLIST_PRODUCT_CATEGORY.id).toBe("product");
    expect(CHECKLIST_PRODUCT_CATEGORY.options).toHaveLength(59);
    expect(CHECKLIST_PRODUCT_CATEGORY.options[0]).toEqual({
      id: "개발기술사업화",
      label: "개발기술사업화",
      order: 0,
    });
  });

  it("id=label 관례(먼데이 프리셋 관례와 동일 — 라벨 자체가 안정적인 키)", () => {
    for (const opt of CHECKLIST_PRODUCT_CATEGORY.options) {
      expect(opt.id).toBe(opt.label);
    }
  });
});
