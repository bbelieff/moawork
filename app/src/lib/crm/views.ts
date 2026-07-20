/**
 * 저장뷰(saved view) 필터·정렬 적용 (T02).
 * 아이템 목록(계산된 수식 포함)에 ViewConfig 를 적용해 화면에 보일 목록을 만든다.
 *
 * 컬럼 참조 규칙:
 *   - columnKey === "__stage__"  → 파이프라인 단계 key
 *   - 그 외 key → 입력값(values) 우선, 없으면 수식값(formulas)
 */

import type {
  CellValue,
  FilterOperator,
  ItemWithValues,
  ViewConfig,
  ViewFilter,
  ViewSort,
} from "./types";

/** 파이프라인 단계를 가리키는 특수 컬럼 key. */
export const STAGE_COLUMN_KEY = "__stage__";

/** 아이템에서 컬럼 key 에 해당하는 값을 뽑는다(단계/입력/수식 순). */
export function resolveCellValue(
  item: ItemWithValues,
  columnKey: string,
  stageKeyOf?: (stageId: string | null) => string | null,
): CellValue {
  if (columnKey === STAGE_COLUMN_KEY) {
    return stageKeyOf ? stageKeyOf(item.stageId) : item.stageId;
  }
  if (columnKey in item.values) return item.values[columnKey];
  if (columnKey in item.formulas) return item.formulas[columnKey];
  return null;
}

function isEmpty(v: CellValue): boolean {
  return v === null || v === undefined || v === "";
}

/** 정렬/비교용 스칼라 변환. */
function comparable(v: CellValue): number | string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  const n = Number(v);
  return v !== "" && Number.isFinite(n) ? n : String(v);
}

/** 단일 필터를 하나의 셀 값에 대해 평가. */
export function matchFilter(cell: CellValue, op: FilterOperator, target?: CellValue): boolean {
  switch (op) {
    case "is_empty":
      return isEmpty(cell);
    case "is_not_empty":
      return !isEmpty(cell);
    case "eq":
      return comparable(cell) === comparable(target ?? null);
    case "neq":
      return comparable(cell) !== comparable(target ?? null);
    case "contains":
      return String(cell ?? "").toLowerCase().includes(String(target ?? "").toLowerCase());
    case "gt":
      return comparable(cell) > comparable(target ?? null);
    case "gte":
      return comparable(cell) >= comparable(target ?? null);
    case "lt":
      return comparable(cell) < comparable(target ?? null);
    case "lte":
      return comparable(cell) <= comparable(target ?? null);
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

function passesFilters(
  item: ItemWithValues,
  filters: ViewFilter[],
  stageKeyOf?: (stageId: string | null) => string | null,
): boolean {
  // 필터는 AND 결합.
  return filters.every((f) =>
    matchFilter(resolveCellValue(item, f.columnKey, stageKeyOf), f.operator, f.value),
  );
}

function applySorts(
  items: ItemWithValues[],
  sorts: ViewSort[],
  stageKeyOf?: (stageId: string | null) => string | null,
): ItemWithValues[] {
  if (sorts.length === 0) return items;
  // 안정 정렬: 원본 인덱스 tie-break.
  return items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      for (const s of sorts) {
        const av = comparable(resolveCellValue(a.item, s.columnKey, stageKeyOf));
        const bv = comparable(resolveCellValue(b.item, s.columnKey, stageKeyOf));
        if (av < bv) return s.direction === "asc" ? -1 : 1;
        if (av > bv) return s.direction === "asc" ? 1 : -1;
      }
      return a.idx - b.idx;
    })
    .map((x) => x.item);
}

/** ViewConfig 를 아이템 목록에 적용(필터 → 정렬). 순수 함수. */
export function applyView(
  items: ItemWithValues[],
  config: ViewConfig,
  stageKeyOf?: (stageId: string | null) => string | null,
): ItemWithValues[] {
  const filtered = passesFiltersAll(items, config.filters ?? [], stageKeyOf);
  return applySorts(filtered, config.sorts ?? [], stageKeyOf);
}

function passesFiltersAll(
  items: ItemWithValues[],
  filters: ViewFilter[],
  stageKeyOf?: (stageId: string | null) => string | null,
): ItemWithValues[] {
  if (filters.length === 0) return items;
  return items.filter((it) => passesFilters(it, filters, stageKeyOf));
}
