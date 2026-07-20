// T09 · 정책자금 프리셋 로더/검증기.
//
// industry_modules.presets_jsonb(002_seed_policyfund.sql) 구조에서 앱이 쓰는
// 7개 선택지 카테고리를 추출한다. 값은 시드가 SSOT — 여기서 하드코딩하지 않는다.

import type {
  OptionCategory,
  OptionCategoryId,
  PolicyfundPresets,
  PresetOption,
  RawBoardColumn,
} from "./types";

/** 시드 실측 기대 개수(002_seed 전수 파싱으로 검증). */
export const EXPECTED_COUNTS: Record<OptionCategoryId, number> = {
  region: 218,
  product: 59,
  agency: 18,
  consult_status: 16,
  contract_status: 11,
  progress_status: 14,
  fund_name: 28,
};

/** 카테고리 표시명(먼데이/사용자 명칭). */
export const CATEGORY_LABELS: Record<OptionCategoryId, string> = {
  region: "지역",
  product: "진행상품",
  agency: "진행기관",
  consult_status: "상담상황",
  contract_status: "계약상황",
  progress_status: "진행상항",
  fund_name: "자금명",
};

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
 * 각 카테고리의 시드 내 출처.
 * kind=field: field_presets[key], kind=column: 특정 보드의 컬럼 라벨 옵션.
 */
type CategorySource =
  | { kind: "field"; key: string }
  | { kind: "column"; board: string; year?: string; label: string };

const SOURCES: Record<OptionCategoryId, CategorySource> = {
  region: { kind: "field", key: "region" },
  product: { kind: "field", key: "product" },
  agency: { kind: "column", board: "업무관리", label: "진행 기관" },
  consult_status: { kind: "column", board: "신규고객", label: "상담 상황" },
  contract_status: { kind: "column", board: "컨텍관리", label: "계약상황" },
  progress_status: { kind: "column", board: "업무관리", label: "진행상항" },
  fund_name: { kind: "column", board: "회계_연도차이", year: "25년", label: "품목" },
};

/** 원본 컬럼 options 를 문자열 배열로 정규화(ref/redacted 는 null). */
function toStringOptions(col: RawBoardColumn | undefined): string[] | null {
  if (!col || !Array.isArray(col.options)) return null;
  return col.options;
}

/** 보드의 컬럼 배열을 가져온다(회계_연도차이 중첩 처리). */
function boardColumns(
  presets: PolicyfundPresets,
  board: string,
  year?: string,
): RawBoardColumn[] {
  const entry = presets.board_columns[board];
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  // 중첩(연도별) 구조
  if (year && Array.isArray(entry[year])) return entry[year];
  return [];
}

/** 문자열 배열을 PresetOption[] 로(라벨=값, 순서 보존). */
function toOptions(values: readonly string[]): PresetOption[] {
  return values.map((label, i) => ({ id: label, label, order: i }));
}

/** 한 카테고리의 옵션 값을 시드에서 추출한다(없으면 빈 배열). */
function extract(presets: PolicyfundPresets, id: OptionCategoryId): string[] {
  const src = SOURCES[id];
  if (src.kind === "field") {
    const arr = presets.field_presets?.[src.key];
    return Array.isArray(arr) ? arr : [];
  }
  const cols = boardColumns(presets, src.board, src.year);
  const col = cols.find((c) => c.label === src.label);
  return toStringOptions(col) ?? [];
}

/** 시드에서 7개 선택지 카테고리를 모두 로드한다. */
export function loadOptionCategories(
  presets: PolicyfundPresets,
): Record<OptionCategoryId, OptionCategory> {
  const out = {} as Record<OptionCategoryId, OptionCategory>;
  for (const id of CATEGORY_IDS) {
    out[id] = {
      id,
      label: CATEGORY_LABELS[id],
      options: toOptions(extract(presets, id)),
    };
  }
  return out;
}

/** 단일 카테고리만 로드. */
export function loadOptionCategory(
  presets: PolicyfundPresets,
  id: OptionCategoryId,
): OptionCategory {
  return {
    id,
    label: CATEGORY_LABELS[id],
    options: toOptions(extract(presets, id)),
  };
}

/** 개수 정합성 위반 1건. */
export interface CountMismatch {
  category: OptionCategoryId;
  expected: number;
  actual: number;
}

/** 로드된 카테고리 개수를 기대치와 대조(빈 배열 = 정상). */
export function validatePresetCounts(
  categories: Record<OptionCategoryId, OptionCategory>,
): CountMismatch[] {
  const mismatches: CountMismatch[] = [];
  for (const id of CATEGORY_IDS) {
    const actual = categories[id].options.length;
    const expected = EXPECTED_COUNTS[id];
    if (actual !== expected) mismatches.push({ category: id, expected, actual });
  }
  return mismatches;
}

/** 시드가 스펙대로 전부 로드됐는지. */
export function isFullyLoaded(
  categories: Record<OptionCategoryId, OptionCategory>,
): boolean {
  return validatePresetCounts(categories).length === 0;
}
