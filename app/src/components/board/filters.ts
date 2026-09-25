/**
 * 도구줄 필터 — 순수 계산부 (ui-guidelines 원칙 4·9).
 *
 * 화면(칩+팝오버)과 판정(어떤 행이 남는가)을 분리해 둔다. 판정이 순수 함수라
 * 테스트가 DOM 없이 돌고, 필터 UI 를 바꿔도 결과 규칙은 흔들리지 않는다.
 *
 * 비교 규칙은 여기서 새로 만들지 않고 `@/lib/boards/cells` 의 `compareCells` 를 쓴다
 * (그 파일 머리말의 "2중/3중 구현 금지" 규약).
 */

import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { cellSearchText, compareCells } from "@/lib/boards/cells";
import { normalizeBoardPhoneDigits } from "./bulk-selection";
import {
  matchesOtherInfoFacet,
  parseOtherInfoFacetFilterKey,
  otherInfoLegacyFromValues,
  otherInfoSearchText,
} from "@/lib/boards/structured-field";

/** 담당자 필터의 "미배정" 을 가리키는 예약값 — assigned_to = null. */
export const UNASSIGNED = "__unassigned__";

export interface BoardFilterState {
  /** 자유 검색어 — 제목 + 모든 셀의 표시 텍스트 대상. */
  q: string;
  /** 담당자(assigned_to) 다중 선택. 빈 배열 = 전체. */
  assignees: string[];
  /** 선택지 컬럼 필터: 컬럼 key → 선택된 옵션 id 배열. 빈 배열 = 전체. */
  byColumn: Record<string, string[]>;
  /** 정렬 기준 컬럼 key. "" = 기본(드래그로 정한 sort_order). */
  sortKey: string;
  sortDir: "asc" | "desc";
  /** 저장 뷰용 다중 정렬. 비어 있으면 위 legacy 단일 정렬을 사용한다. */
  sorts?: Array<{ columnKey: string; direction: "asc" | "desc" }>;
  /** 이전 저장 뷰 역호환 슬롯. #576부터 제품 UI는 앞 N개 제한을 쓰지 않으며 항상 0이다. */
  columnLimit: number;
  /** `null` = 전부, 배열 = 정확히 표시할 컬럼 key. 빈 배열은 이름 열만 표시한다. */
  visibleColumnKeys?: string[] | null;
}

/**
 * 물리 셀 하나로 표현되지 않는 presentation column의 검색/정렬 seam.
 * 생략하면 기존 보드의 공통 셀 계약을 그대로 사용한다.
 */
export interface BoardFilterProjection {
  searchText?: (row: ItemWithValues, column: BoardColumn) => string | null;
  /** null이면 공통 비교로 fallback. 숫자면 direction까지 반영한 최종 비교값이다. */
  compareRows?: (
    left: ItemWithValues,
    right: ItemWithValues,
    columnKey: string,
    direction: "asc" | "desc",
  ) => number | null;
}

export const EMPTY_FILTERS: BoardFilterState = {
  q: "",
  assignees: [],
  byColumn: {},
  sortKey: "",
  sortDir: "asc",
  columnLimit: 0,
  visibleColumnKeys: null,
};

export const BOARD_FILTER_QUERY_KEY = "mwFilters";

/**
 * 필터 URL 계약. 저장 뷰(BBE-117)의 영속 포맷과 분리된, 새로고침 복원용 계약이다.
 * 알 수 없는/깨진 입력은 빈 필터로 닫아 화면과 권한 필터를 우회하지 않는다.
 */
export function canonicalBoardFilters(filters: BoardFilterState): BoardFilterState {
  const byColumn = Object.fromEntries(
    Object.entries(filters.byColumn)
      .filter(([, picked]) => picked.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, picked]) => [key, [...new Set(picked)].sort()]),
  );
  return {
    ...filters,
    assignees: [...new Set(filters.assignees)].sort(),
    byColumn,
  };
}

export function canonicalBoardFiltersJson(filters: BoardFilterState): string {
  return JSON.stringify(canonicalBoardFilters(filters));
}

export function encodeBoardFilters(filters: BoardFilterState): string {
  return canonicalBoardFiltersJson(filters);
}

export function decodeBoardFilters(value: string | null): BoardFilterState {
  if (!value) return EMPTY_FILTERS;
  try {
    const parsed = JSON.parse(value) as Partial<BoardFilterState>;
    const byColumn = Object.fromEntries(
      Object.entries(parsed.byColumn ?? {}).filter(
        (entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) && entry[1].every((item) => typeof item === "string"),
      ),
    );
    return canonicalBoardFilters({
      q: typeof parsed.q === "string" ? parsed.q : "",
      assignees: Array.isArray(parsed.assignees)
        ? parsed.assignees.filter((item): item is string => typeof item === "string")
        : [],
      byColumn,
      sortKey: typeof parsed.sortKey === "string" ? parsed.sortKey : "",
      sortDir: parsed.sortDir === "desc" ? "desc" : "asc",
      ...(Array.isArray(parsed.sorts)
        ? { sorts: parsed.sorts.flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const row = entry as { columnKey?: unknown; direction?: unknown };
            return typeof row.columnKey === "string" && row.columnKey !== ""
              && (row.direction === "asc" || row.direction === "desc")
              ? [{ columnKey: row.columnKey, direction: row.direction }]
              : [];
          }) }
        : {}),
      // #576 — 과거의 근거 없는 앞 N개(8/12/16)는 복원하지 않는다.
      columnLimit: 0,
      visibleColumnKeys: Array.isArray(parsed.visibleColumnKeys)
        ? parsed.visibleColumnKeys.filter((item): item is string => typeof item === "string")
        : null,
    });
  } catch {
    return EMPTY_FILTERS;
  }
}

/** BBE-117이 수신할 저장 뷰 handoff payload. 이 모듈은 영속화를 수행하지 않는다. */
export function savedViewFilterPayload(filters: BoardFilterState) {
  return {
    version: 1 as const,
    filters: decodeBoardFilters(encodeBoardFilters(filters)),
  };
}

/** 활성 필터 개수 — 칩 accent 틴트와 "필터 초기화" 노출 판정에 쓴다. */
export function activeFilterCount(f: BoardFilterState): number {
  let n = 0;
  if (f.q.trim() !== "") n += 1;
  if (f.assignees.length > 0) n += 1;
  for (const picked of Object.values(f.byColumn)) if (picked.length > 0) n += 1;
  if ((f.sorts?.length ?? 0) > 0 || f.sortKey !== "") n += 1;
  if (f.visibleColumnKeys !== undefined && f.visibleColumnKeys !== null) n += 1;
  return n;
}

/**
 * 「필터」 버튼의 배지에 붙는 수 (#655). 접힌 패널 안에 걸린 facet 개수다.
 *
 * ★ activeFilterCount 와 «일부러» 다르다.
 *   저쪽은 「초기화」 버튼을 띄울지 정하려고 «지금 무엇이든 걸려 있나» 를 센다 —
 *   검색어·정렬·표시 컬럼까지 포함한다.
 *   여기는 «접힌 패널 안에 몇 개가 걸려 있나» 다. 검색은 패널 밖에 그대로 보이고
 *   정렬·표시 컬럼은 「보기」 묶음에 있으므로, 그것들을 세면 배지가
 *   «열어도 그 수가 안 보이는» 거짓말을 한다.
 */
export function activeFacetCount(f: BoardFilterState): number {
  let n = 0;
  if (f.assignees.length > 0) n += 1;
  for (const picked of Object.values(f.byColumn)) if (picked.length > 0) n += 1;
  return n;
}

/**
 * 검색 대상 텍스트 — 제목 + 모든 셀의 **표시 텍스트**(옵션 id 가 아니라 라벨) + 담당자 표시 이름.
 * 담당자 id(UUID) 자체는 넣지 않는다 — 화면에 보이는 라벨로만 찾는다 (숨은 값 노출 금지).
 */
function haystack(
  row: ItemWithValues,
  columns: readonly BoardColumn[],
  projection?: BoardFilterProjection,
  assigneeLabels?: Readonly<Record<string, string>>,
): string {
  const cells = columns.map((c) => projection?.searchText?.(row, c)
    ?? (c.type === "other_info"
      ? otherInfoSearchText(row.values[c.key] ?? null, otherInfoLegacyFromValues(row.values))
      : cellSearchText(c.type, row.values[c.key] ?? null, c.options_jsonb?.options)));
  const assigneeLabel = row.assigned_to ? (assigneeLabels?.[row.assigned_to] ?? "") : "";
  return [row.title, assigneeLabel, ...cells].join(" ").toLowerCase();
}

/**
 * 전화 숫자 대상 — phone 타입 셀 + 제목에 섞인 번호를 표기 차이 없이 견준다.
 * 질의·필드 양쪽을 normalizeBoardPhoneDigits 로 수렴시킨다 (+82/하이픈/공백 해소).
 */
function phoneDigitHaystack(
  row: ItemWithValues,
  columns: readonly BoardColumn[],
): string {
  const parts: string[] = [normalizeBoardPhoneDigits(row.title)];
  for (const column of columns) {
    if (column.type !== "phone") continue;
    const raw = row.values[column.key];
    if (typeof raw === "string" && raw !== "") parts.push(normalizeBoardPhoneDigits(raw));
  }
  return parts.join(" ");
}

/** 셀 값이 선택된 옵션 중 하나라도 포함하는가. multiselect 는 교집합 판정. */
function matchesOptions(value: unknown, picked: readonly string[]): boolean {
  if (picked.length === 0) return true;
  if (Array.isArray(value)) return value.some((v) => picked.includes(String(v)));
  if (value === null || value === undefined) return false;
  return picked.includes(String(value));
}

/** 한 행이 필터를 통과하는가. */
export function rowMatches(
  row: ItemWithValues,
  columns: readonly BoardColumn[],
  f: BoardFilterState,
  projection?: BoardFilterProjection,
  assigneeLabels?: Readonly<Record<string, string>>,
): boolean {
  const q = f.q.trim().toLowerCase();
  if (q !== "") {
    if (haystack(row, columns, projection, assigneeLabels).includes(q)) {
      // 표시 텍스트 적중 — 아래 숫자 매칭은 건너뛴다.
    } else {
      // 숫자 섞인 질의는 번호 찾기로 본다 — 표기 차이(+82/하이픈/공백)를 지우고 견준다.
      const queryDigits = normalizeBoardPhoneDigits(f.q);
      if (queryDigits.length < 3 || !phoneDigitHaystack(row, columns).includes(queryDigits)) {
        return false;
      }
    }
  }

  if (f.assignees.length > 0) {
    const who = row.assigned_to ?? UNASSIGNED;
    if (!f.assignees.includes(who)) return false;
  }

  for (const [key, picked] of Object.entries(f.byColumn)) {
    const otherInfoFacet = parseOtherInfoFacetFilterKey(key);
    if (otherInfoFacet) {
      const selected = picked.filter((state): state is "missing" | "false" | "true" =>
        state === "missing" || state === "false" || state === "true");
      if (selected.length !== picked.length) return false;
      if (!matchesOtherInfoFacet(
        row.values[otherInfoFacet.columnKey] ?? null,
        otherInfoFacet.facetKey,
        selected,
        otherInfoFacet.columnKey === "other_info" ? otherInfoLegacyFromValues(row.values) : undefined,
      )) return false;
      continue;
    }
    if (!matchesOptions(row.values[key] ?? null, picked)) return false;
  }
  return true;
}

/**
 * 필터 + 정렬 적용.
 *
 * 정렬 기준이 없으면 **행 순서를 건드리지 않는다** — 그 순서가 곧 사용자가 드래그로
 * 정한 배치이기 때문이다(정렬 칩을 켜면 그때만 덮어쓴다).
 */
export function applyFilters(
  rows: readonly ItemWithValues[],
  columns: readonly BoardColumn[],
  f: BoardFilterState,
  projection?: BoardFilterProjection,
  assigneeLabels?: Readonly<Record<string, string>>,
): ItemWithValues[] {
  const kept = rows.filter((r) => rowMatches(r, columns, f, projection, assigneeLabels));
  const sorts = f.sorts?.length
    ? f.sorts
    : f.sortKey
      ? [{ columnKey: f.sortKey, direction: f.sortDir }]
      : [];
  if (sorts.length === 0) return kept;

  return kept.map((row, index) => ({ row, index })).sort((a, b) => {
    for (const sort of sorts) {
      const projected = projection?.compareRows?.(a.row, b.row, sort.columnKey, sort.direction);
      if (projected !== null && projected !== undefined) {
        if (projected !== 0) return projected;
        continue;
      }
      const compared = compareCells(
          a.row.values[sort.columnKey] ?? null,
          b.row.values[sort.columnKey] ?? null,
        );
      if (compared !== 0) return sort.direction === "desc" ? -compared : compared;
    }
    return a.index - b.index;
  }).map(({ row }) => row);
}

/** 이전 저장 뷰 테스트용 역호환 함수. 제품 UI는 `selectVisibleColumns`를 사용한다. */
export function limitColumns(
  columns: readonly BoardColumn[],
  limit: number,
): BoardColumn[] {
  if (limit <= 0 || limit >= columns.length) return [...columns];
  return columns.slice(0, limit);
}

/** #576 — 앞 N개가 아니라 사용자가 이름으로 고른 정확한 열만 남긴다. */
export function selectVisibleColumns(
  columns: readonly BoardColumn[],
  visibleColumnKeys: readonly string[] | null | undefined,
): BoardColumn[] {
  if (visibleColumnKeys === null || visibleColumnKeys === undefined) return [...columns];
  const visible = new Set(visibleColumnKeys);
  return columns.filter((column) => visible.has(column.key));
}

/**
 * 담당자 필터·탭의 선택지 — 데이터에 실제로 존재하는 담당자 + 미배정.
 *
 * `assigned_to` 는 사용자 **id** 다. 라벨 맵을 주지 않으면 id 가 그대로 화면에 나오므로
 * (담당자 탭에 UUID 가 뜬다) 호출부가 조직 멤버 이름을 실어 준다. 맵에 없는 id 는 숨기지
 * 않고 id 그대로 남긴다 — 이름을 못 찾았다는 사실이 보이는 편이 조용히 빠지는 것보다 낫다.
 */
export function assigneeOptions(
  rows: readonly ItemWithValues[],
  labels: Readonly<Record<string, string>> = {},
): { value: string; label: string }[] {
  const seen = new Set<string>();
  let hasUnassigned = false;
  for (const r of rows) {
    if (r.assigned_to) seen.add(r.assigned_to);
    else hasUnassigned = true;
  }
  const opts = [...seen]
    .map((v) => ({ value: v, label: labels[v] ?? v }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  if (hasUnassigned) opts.push({ value: UNASSIGNED, label: "미배정" });
  return opts;
}
