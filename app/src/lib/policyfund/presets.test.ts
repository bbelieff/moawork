import { describe, it, expect } from "vitest";
import type { OptionCategoryId, PresetOption } from "./types";
import {
  EXPECTED_COUNTS,
  CATEGORY_IDS,
  CATEGORY_LABELS,
  validatePresetCounts,
  isFullyLoaded,
  getCategory,
} from "./presets";

/** 테스트용 합성 옵션 n개 생성(실 도메인 값 아님 · 검증 로직 확인용). */
function fill(n: number): PresetOption[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `x${i}`,
    label: `opt${i}`,
  }));
}

/** 기대 개수대로 전 카테고리를 채운 합성 세트. */
function fullMock(): Record<OptionCategoryId, PresetOption[]> {
  const out = {} as Record<OptionCategoryId, PresetOption[]>;
  for (const id of CATEGORY_IDS) out[id] = fill(EXPECTED_COUNTS[id]);
  return out;
}

describe("EXPECTED_COUNTS", () => {
  it("기획 v0.2 명세 개수를 담는다(지역 218·상품 59·기관 18 등)", () => {
    expect(EXPECTED_COUNTS.region).toBe(218);
    expect(EXPECTED_COUNTS.product).toBe(59);
    expect(EXPECTED_COUNTS.agency).toBe(18);
    expect(EXPECTED_COUNTS.consult_status).toBe(16);
    expect(EXPECTED_COUNTS.contract_status).toBe(11);
    expect(EXPECTED_COUNTS.progress_status).toBe(14);
    expect(EXPECTED_COUNTS.fund_name).toBe(28);
  });

  it("7개 카테고리 모두 라벨과 기대치를 가진다", () => {
    expect(CATEGORY_IDS).toHaveLength(7);
    for (const id of CATEGORY_IDS) {
      expect(CATEGORY_LABELS[id]).toBeTruthy();
      expect(EXPECTED_COUNTS[id]).toBeGreaterThan(0);
    }
  });
});

describe("validatePresetCounts", () => {
  it("스펙대로 로드되면 위반이 없다", () => {
    expect(validatePresetCounts(fullMock())).toEqual([]);
    expect(isFullyLoaded(fullMock())).toBe(true);
  });

  it("개수가 어긋나면 위반을 보고한다", () => {
    const partial = fullMock();
    partial.region = fill(200); // 218 기대 → 200
    const mismatches = validatePresetCounts(partial);
    expect(mismatches).toContainEqual({
      category: "region",
      expected: 218,
      actual: 200,
    });
    expect(isFullyLoaded(partial)).toBe(false);
  });

  it("현재 시드 미로드 상태(빈 값)는 전 카테고리 위반", () => {
    // 기본값(PRESET_OPTIONS)은 아직 비어 있음 — 002_seed 확정 전 상태.
    expect(validatePresetCounts()).toHaveLength(7);
    expect(isFullyLoaded()).toBe(false);
  });
});

describe("getCategory", () => {
  it("id 로 라벨+옵션 구조를 반환한다", () => {
    const c = getCategory("agency");
    expect(c.id).toBe("agency");
    expect(c.label).toBe("진행기관");
    expect(Array.isArray(c.options)).toBe(true);
  });
});
