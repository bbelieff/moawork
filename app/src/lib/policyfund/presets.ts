// T09 · 정책자금 프리셋 데이터 레이어.
//
// 선택지 옵션(지역/진행상품/진행기관/상담상황/계약상황/진행상항/자금명)의
// 실제 값 SSOT 는 supabase/migrations/002_seed_policyfund.sql 다.
// 이 모듈은 (1) 카테고리 구조, (2) 기획 v0.2 가 명시한 기대 개수,
// (3) 시드가 로드되면 그 정합성을 검증하는 로직을 제공한다.
//
// ⚠️ 실제 옵션 값은 여기에 지어 넣지 않는다. 시드 확정 시 로더가 채운다.

import type {
  OptionCategory,
  OptionCategoryId,
  PresetOption,
} from "./types";

/** 기획 v0.2 명세상의 카테고리별 기대 옵션 개수. */
export const EXPECTED_COUNTS: Record<OptionCategoryId, number> = {
  region: 218, // 지역
  product: 59, // 진행상품
  agency: 18, // 진행기관
  consult_status: 16, // 상담상황
  contract_status: 11, // 계약상황
  progress_status: 14, // 진행상항(진행상황)
  fund_name: 28, // 자금명
};

/** 카테고리 표시명(먼데이/사용자 명칭 그대로). */
export const CATEGORY_LABELS: Record<OptionCategoryId, string> = {
  region: "지역",
  product: "진행상품",
  agency: "진행기관",
  consult_status: "상담상황",
  contract_status: "계약상황",
  progress_status: "진행상항",
  fund_name: "자금명",
};

/** 전체 카테고리 id 목록(안정 순서). */
export const CATEGORY_IDS: readonly OptionCategoryId[] = [
  "region",
  "product",
  "agency",
  "consult_status",
  "contract_status",
  "progress_status",
  "fund_name",
];

/**
 * 시드에서 로드된 옵션 값 저장소.
 * 002_seed_policyfund.sql 확정 후 로더(추후 T02 API/서버 로드)가 주입한다.
 * 현재는 비어 있음 — 값을 하드코딩하지 않는다(도메인 데이터 조작 금지).
 */
export const PRESET_OPTIONS: Record<OptionCategoryId, PresetOption[]> = {
  region: [],
  product: [],
  agency: [],
  consult_status: [],
  contract_status: [],
  progress_status: [],
  fund_name: [],
};

/** 카테고리 1개를 (라벨 + 옵션) 구조로 조회한다. */
export function getCategory(id: OptionCategoryId): OptionCategory {
  return {
    id,
    label: CATEGORY_LABELS[id],
    options: PRESET_OPTIONS[id],
  };
}

/** 개수 정합성 위반 1건. */
export interface CountMismatch {
  category: OptionCategoryId;
  expected: number;
  actual: number;
}

/**
 * 로드된 옵션 개수를 기대치(EXPECTED_COUNTS)와 대조한다.
 * 시드가 스펙대로 로드됐는지 검증하는 게이트. 위반 목록을 반환(빈 배열 = 정상).
 *
 * @param options 검증 대상(기본값: 현재 PRESET_OPTIONS).
 */
export function validatePresetCounts(
  options: Record<OptionCategoryId, PresetOption[]> = PRESET_OPTIONS,
): CountMismatch[] {
  const mismatches: CountMismatch[] = [];
  for (const id of CATEGORY_IDS) {
    const actual = options[id].length;
    const expected = EXPECTED_COUNTS[id];
    if (actual !== expected) {
      mismatches.push({ category: id, expected, actual });
    }
  }
  return mismatches;
}

/** 시드가 스펙대로 전부 로드됐는지 여부. */
export function isFullyLoaded(
  options: Record<OptionCategoryId, PresetOption[]> = PRESET_OPTIONS,
): boolean {
  return validatePresetCounts(options).length === 0;
}
