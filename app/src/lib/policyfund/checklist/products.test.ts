import { describe, expect, it } from "vitest";
import { CHECKLIST_PRODUCT_CATEGORY, CHECKLIST_PRODUCT_LABELS } from "./products";

// dump 원문(2026-08-11 실측, node docs/design/dump-mockup.mjs work):
//   진행 상품 : 혁신성장 일반 · 혁신성장 혁신형 · 소공인 대리대출 · 기보 혁신리딩 ·
//              신보 유동화 · 경기신보 특례 · 벤처기업 인증
describe("CHECKLIST_PRODUCT_LABELS", () => {
  it("v6 목업 dump 출력과 순서·개수가 정확히 같다(7종)", () => {
    expect(CHECKLIST_PRODUCT_LABELS).toEqual([
      "혁신성장 일반",
      "혁신성장 혁신형",
      "소공인 대리대출",
      "기보 혁신리딩",
      "신보 유동화",
      "경기신보 특례",
      "벤처기업 인증",
    ]);
  });

  it("lib/policyfund/presets 의 구세대 59종과 다르다(섞이지 않았다)", () => {
    expect(CHECKLIST_PRODUCT_LABELS.length).toBe(7);
    expect(CHECKLIST_PRODUCT_LABELS.length).not.toBe(59);
  });
});

describe("CHECKLIST_PRODUCT_CATEGORY", () => {
  it("ChecklistPanel/ProductChecklistAdmin 이 바로 쓸 수 있는 OptionCategory 형태다", () => {
    expect(CHECKLIST_PRODUCT_CATEGORY.id).toBe("product");
    expect(CHECKLIST_PRODUCT_CATEGORY.options).toHaveLength(7);
    expect(CHECKLIST_PRODUCT_CATEGORY.options[0]).toEqual({
      id: "혁신성장 일반",
      label: "혁신성장 일반",
      order: 0,
    });
  });

  it("id=label 관례(먼데이 프리셋 관례와 동일 — 라벨 자체가 안정적인 키)", () => {
    for (const opt of CHECKLIST_PRODUCT_CATEGORY.options) {
      expect(opt.id).toBe(opt.label);
    }
  });
});
