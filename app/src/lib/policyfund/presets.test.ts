import { describe, it, expect } from "vitest";
import {
  EXPECTED_COUNTS,
  CATEGORY_IDS,
  CATEGORY_LABELS,
  loadOptionCategories,
  loadOptionCategory,
  validatePresetCounts,
  isFullyLoaded,
} from "./presets";
import { fullPresets } from "./fixture";

describe("EXPECTED_COUNTS (002_seed 실측)", () => {
  it("지역218·상품59·기관18·상담16·계약11·진행14·자금28", () => {
    expect(EXPECTED_COUNTS).toEqual({
      region: 218,
      product: 59,
      agency: 18,
      consult_status: 16,
      contract_status: 11,
      progress_status: 14,
      fund_name: 28,
    });
  });

  it("7개 카테고리 모두 라벨을 가진다", () => {
    expect(CATEGORY_IDS).toHaveLength(7);
    for (const id of CATEGORY_IDS) expect(CATEGORY_LABELS[id]).toBeTruthy();
  });
});

describe("loadOptionCategories — 시드 구조에서 7개 카테고리 추출", () => {
  const cats = loadOptionCategories(fullPresets());

  it("field_presets 에서 region/product 를 추출", () => {
    expect(cats.region.options).toHaveLength(218);
    expect(cats.product.options).toHaveLength(59);
    expect(cats.region.options[0]).toEqual({
      id: "지역1",
      label: "지역1",
      order: 0,
    });
  });

  it("board_columns 옵션에서 상태 카테고리를 정확한 라벨로 추출", () => {
    // SOURCES 매핑(보드·컬럼 라벨)이 어긋나면 빈 배열 → 개수 불일치로 잡힘
    expect(cats.agency.options).toHaveLength(18); // 업무관리 · 진행 기관
    expect(cats.consult_status.options).toHaveLength(16); // 신규고객 · 상담 상황
    expect(cats.contract_status.options).toHaveLength(11); // 컨텍관리 · 계약상황
    expect(cats.progress_status.options).toHaveLength(14); // 업무관리 · 진행상항
    expect(cats.fund_name.options).toHaveLength(28); // 회계_연도차이 25년 · 품목
  });

  it("라벨=값 이며 순서를 보존한다", () => {
    const c = loadOptionCategory(fullPresets(), "agency");
    expect(c.label).toBe("진행기관");
    expect(c.options[0]).toEqual({ id: "기관1", label: "기관1", order: 0 });
  });
});

describe("validatePresetCounts", () => {
  it("완전 로드 시 위반 없음", () => {
    const cats = loadOptionCategories(fullPresets());
    expect(validatePresetCounts(cats)).toEqual([]);
    expect(isFullyLoaded(cats)).toBe(true);
  });

  it("옵션이 비면(잘못된 라벨 매핑 등) 위반을 보고", () => {
    const presets = fullPresets();
    // 컬럼 라벨을 바꿔 매핑을 깨뜨림 → agency 추출 0
    const work = presets.board_columns["업무관리"];
    if (Array.isArray(work)) {
      const col = work.find((c) => c.label === "진행 기관");
      if (col) col.label = "진행기관_변경됨";
    }
    const cats = loadOptionCategories(presets);
    expect(validatePresetCounts(cats)).toContainEqual({
      category: "agency",
      expected: 18,
      actual: 0,
    });
    expect(isFullyLoaded(cats)).toBe(false);
  });

  it("빈 프리셋은 전 카테고리 위반", () => {
    const empty = {
      pipeline_stages: [],
      board_columns: {},
      field_presets: {},
    };
    const cats = loadOptionCategories(empty);
    expect(validatePresetCounts(cats)).toHaveLength(7);
  });
});
