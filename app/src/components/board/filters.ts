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
import { compareCells, formatCell } from "@/lib/boards/cells";

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
  /** 표시할 컬럼 개수(원칙 8 의 "컬럼수" 칩). 0 = 전부. */
  columnLimit: number;
}

export const EMPTY_FILTERS: BoardFilterState = {
  q: "",
  assignees: [],
  byColumn: {},
  sortKey: "",
  sortDir: "asc",
  columnLimit: 0,
};

export const BOARD_FILTER_QUERY_KEY = "mwFilters";

/**
 * 필터 URL 계약. 저장 뷰(BBE-117)의 영속 포맷과 분리된, 새로고침 복원용 계약이다.
 * 알 수 없는/깨진 입력은 빈 필터로 닫아 화면과 권한 필터를 우회하지 않는다.
 */
export function encodeBoardFilters(filters: BoardFilterState): string {
  return JSON.stringify(filters);
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
    return {
      q: typeof parsed.q === "string" ? parsed.q : "",
      assignees: Array.isArray(parsed.assignees)
        ? parsed.assignees.filter((item): item is string => typeof item === "string")
        : [],
      byColumn,
      sortKey: typeof parsed.sortKey === "string" ? parsed.sortKey : "",
      sortDir: parsed.sortDir === "desc" ? "desc" : "asc",
      columnLimit:
        typeof parsed.columnLimit === "number" && Number.isFinite(parsed.columnLimit)
          ? Math.max(0, Math.floor(parsed.columnLimit))
          : 0,
    };
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
  if (f.sortKey !== "") n += 1;
  if (f.columnLimit > 0) n += 1;
  return n;
}

/** 검색 대상 텍스트 — 제목 + 모든 셀의 **표시 텍스트**(옵션 id 가 아니라 라벨). */
function haystack(row: ItemWithValues, columns: readonly BoardColumn[]): string {
  const cells = columns.map((c) =>
    formatCell(c.type, row.values[c.key] ?? null, c.options_jsonb?.options),
  );
  return [row.title, ...cells].join(" ").toLowerCase();
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
): boolean {
  const q = f.q.trim().toLowerCase();
  if (q !== "" && !haystack(row, columns).includes(q)) return false;

  if (f.assignees.length > 0) {
    const who = row.assigned_to ?? UNASSIGNED;
    if (!f.assignees.includes(who)) return false;
  }

  for (const [key, picked] of Object.entries(f.byColumn)) {
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
): ItemWithValues[] {
  const kept = rows.filter((r) => rowMatches(r, columns, f));
  if (f.sortKey === "") return kept;

  const dir = f.sortDir === "desc" ? -1 : 1;
  return [...kept].sort(
    (a, b) => dir * compareCells(a.values[f.sortKey] ?? null, b.values[f.sortKey] ?? null),
  );
}

/** 원칙 8 의 "컬럼수" 칩 — 앞에서 N개만 남긴다. 0 이면 전부. */
export function limitColumns(
  columns: readonly BoardColumn[],
  limit: number,
): BoardColumn[] {
  if (limit <= 0 || limit >= columns.length) return [...columns];
  return columns.slice(0, limit);
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
