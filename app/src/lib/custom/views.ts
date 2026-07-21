/**
 * 저장뷰(saved view) 엔진 (T05 core.custom).
 *
 * 001_schema_v1.sql 의 `saved_views`(filters_jsonb / sort_jsonb / columns_jsonb)를
 * 내부 ViewConfig 로 왕복 변환하고, 엔티티 행 목록에 필터·정렬을 적용한다.
 *
 * 값 참조 규칙: 코어 컬럼(예: title/amount) 은 행 자체에서, 커스텀필드 key 는
 * field_values 맵(valuesOf)에서 뽑는다. 비교/공백 판정은 field-types 레지스트리와
 * 호환되는 규약(comparable/isEmpty)을 쓴다.
 *
 * 순수 모듈. T02 crm/views.ts 와 로직이 겹치므로, T02 재작성 정착 후 공용화 검토(followup).
 */

import type { FieldType, SavedView } from "./domain-types";
import {
  getFieldTypeSpec,
  type FilterOperator,
  type JsonValue,
} from "./field-types";

export interface ViewFilter {
  fieldKey: string;
  operator: FilterOperator;
  value?: JsonValue;
}

export interface ViewSort {
  fieldKey: string;
  direction: "asc" | "desc";
}

export interface ViewConfig {
  filters: ViewFilter[];
  sorts: ViewSort[];
  /** 표시할 컬럼 key 목록(비면 전체). */
  columns: string[];
}

// ── 001 saved_views(jsonb) ↔ ViewConfig 어댑터 ──────────────

/** 001 row 의 3개 jsonb → 내부 ViewConfig. 형식 불명 항목은 방어적으로 건너뜀. */
export function toViewConfig(row: Pick<SavedView, "filters_jsonb" | "sort_jsonb" | "columns_jsonb">): ViewConfig {
  return {
    filters: parseFilters(row.filters_jsonb),
    sorts: parseSorts(row.sort_jsonb),
    columns: parseColumns(row.columns_jsonb),
  };
}

/** 내부 ViewConfig → 001 row 의 3개 jsonb. */
export function fromViewConfig(config: ViewConfig): Pick<SavedView, "filters_jsonb" | "sort_jsonb" | "columns_jsonb"> {
  return {
    filters_jsonb: { filters: config.filters },
    sort_jsonb: config.sorts,
    columns_jsonb: config.columns,
  };
}

function parseFilters(raw: unknown): ViewFilter[] {
  // filters_jsonb 는 { filters: ViewFilter[] } 형태로 저장.
  const arr =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).filters
      : raw;
  if (!Array.isArray(arr)) return [];
  const out: ViewFilter[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.fieldKey !== "string" || typeof rec.operator !== "string") continue;
    const f: ViewFilter = { fieldKey: rec.fieldKey, operator: rec.operator as FilterOperator };
    if (rec.value !== undefined) f.value = rec.value as JsonValue;
    out.push(f);
  }
  return out;
}

function parseSorts(raw: unknown): ViewSort[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewSort[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.fieldKey !== "string") continue;
    if (rec.direction !== "asc" && rec.direction !== "desc") continue;
    out.push({ fieldKey: rec.fieldKey, direction: rec.direction });
  }
  return out;
}

function parseColumns(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

// ── 기본 뷰 선택 (OQ-4 확정 규약) ───────────────────────────

/**
 * 기본 뷰 후보의 최소 형태. 001 `saved_views` 와 003 `board_views` 가
 * 둘 다 만족하므로(구조적 타이핑) 두 표면에서 같은 함수를 쓴다.
 */
export interface DefaultViewCandidate {
  id: string;
  name: string;
  shared: boolean;
}

/**
 * 기본 뷰 비교자 — **shared 우선 → name ASC → id ASC(tie-break)**.
 *
 * 배경(기획2 재판정 2026-07-21, OQ-4):
 * - `created_at` 은 001 `saved_views`·003 `board_views` **양쪽 모두 부재** → 생성순 불가.
 *   `id` 는 `gen_random_uuid()`(v4 랜덤)이라 생성순 대용이 안 된다.
 * - `sort_order` 는 쓰지 않는다 — 사용자가 뷰를 재정렬하면 기본이 바뀌기 때문.
 * - 그래서 스키마 변경 없이 **결정적**인 위 규약으로 확정.
 *
 * 이름 비교는 로케일 비의존 코드유닛 순서를 쓴다(환경/ICU 버전에 따라 결과가
 * 달라지지 않도록 — 기본 뷰 선택은 표시 정렬과 달리 **결정성**이 우선).
 *
 * Phase 후속에 `created_at` + `is_default` 가 두 테이블에 동시 추가되면
 * **이 함수만 교체**하면 된다(호출부 불변).
 */
function compareDefaultView(a: DefaultViewCandidate, b: DefaultViewCandidate): number {
  if (a.shared !== b.shared) return a.shared ? -1 : 1; // 공유 뷰 우선
  if (a.name !== b.name) return a.name < b.name ? -1 : 1; // name ASC
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // id ASC (tie-break)
}

/** 뷰 목록에서 기본 뷰 1개를 고른다. 빈 목록이면 null. 순수·결정적. */
export function pickDefaultView<V extends DefaultViewCandidate>(views: readonly V[]): V | null {
  if (views.length === 0) return null;
  return views.reduce((best, v) => (compareDefaultView(v, best) < 0 ? v : best));
}

// ── 필터·정렬 적용 ─────────────────────────────────────────

/** 한 엔티티 행에 대한 값 조회 함수. 코어 컬럼 + 커스텀필드 통합 뷰. */
export type CellResolver<T> = (row: T, fieldKey: string) => JsonValue | null;

/** 필드 key → 타입. 필터/정렬 비교 규약 선택에 사용. 미지정 key 는 text 취급. */
export type FieldTypeLookup = (fieldKey: string) => FieldType | undefined;

function comparableFor(lookup: FieldTypeLookup | undefined, key: string, v: JsonValue | null): number | string {
  const t = lookup?.(key);
  return getFieldTypeSpec(t ?? "text").comparable(v);
}

function isEmptyFor(lookup: FieldTypeLookup | undefined, key: string, v: JsonValue | null): boolean {
  const t = lookup?.(key);
  return getFieldTypeSpec(t ?? "text").isEmpty(v);
}

/** 단일 필터를 하나의 셀 값에 평가. */
export function matchFilter(
  cell: JsonValue | null,
  op: FilterOperator,
  target: JsonValue | undefined,
  key: string,
  lookup?: FieldTypeLookup,
): boolean {
  const cmp = (v: JsonValue | null | undefined) => comparableFor(lookup, key, (v ?? null) as JsonValue | null);
  switch (op) {
    case "is_empty":
      return isEmptyFor(lookup, key, cell);
    case "is_not_empty":
      return !isEmptyFor(lookup, key, cell);
    case "eq":
      return cmp(cell) === cmp(target);
    case "neq":
      return cmp(cell) !== cmp(target);
    case "contains": {
      // 배열(multiselect)은 요소 포함, 그 외는 부분 문자열.
      if (Array.isArray(cell)) return cell.map((x) => String(x)).includes(String(target ?? ""));
      return String(cell ?? "").toLowerCase().includes(String(target ?? "").toLowerCase());
    }
    case "gt":
      return cmp(cell) > cmp(target);
    case "gte":
      return cmp(cell) >= cmp(target);
    case "lt":
      return cmp(cell) < cmp(target);
    case "lte":
      return cmp(cell) <= cmp(target);
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/** ViewConfig 를 행 목록에 적용(필터 AND → 다중 정렬, 안정). 순수 함수. */
export function applyView<T>(
  rows: T[],
  config: ViewConfig,
  resolve: CellResolver<T>,
  lookup?: FieldTypeLookup,
): T[] {
  const filters = config.filters ?? [];
  const sorts = config.sorts ?? [];

  const filtered =
    filters.length === 0
      ? rows
      : rows.filter((row) =>
          filters.every((f) => matchFilter(resolve(row, f.fieldKey), f.operator, f.value, f.fieldKey, lookup)),
        );

  if (sorts.length === 0) return filtered;

  return filtered
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      for (const s of sorts) {
        const av = comparableFor(lookup, s.fieldKey, resolve(a.row, s.fieldKey));
        const bv = comparableFor(lookup, s.fieldKey, resolve(b.row, s.fieldKey));
        if (av < bv) return s.direction === "asc" ? -1 : 1;
        if (av > bv) return s.direction === "asc" ? 1 : -1;
      }
      return a.idx - b.idx; // 안정 정렬(원본 인덱스 tie-break)
    })
    .map((x) => x.row);
}
