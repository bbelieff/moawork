/**
 * 보기 조건 — #845 6단계(2026-10-08 대표 결정).
 *
 * 세 가지를 나눈다.
 *   · 찾기   — 잠깐 쓰는 검색. 저장하지 않고, 뷰를 «바뀜» 으로 만들지 않는다.
 *   · 보기 조건 — 보기 방식(표·칸반·캘린더) · 담당 · 필터(필터) · 정렬 · 나눠 보기 · 보이는 칸.
 *   · 뷰     — 보기 조건 + 이름 + 나만/팀. 탭으로 보인다.
 *
 * 칸 순서는 보드 전체의 것이라(모두에게 바뀜) 보기 조건이 아니다. 그래서 여기서 비교하지 않는다.
 * 이 파일은 화면이 없는 순수 계산이다 — 바뀐 조건 세기·칩 글자·건수 글자·저장할 설정 만들기.
 */

import {
  BOARD_FILTER_QUERY_KEY,
  canonicalBoardFilters,
  decodeBoardFilters,
  encodeBoardFilters,
  UNASSIGNED,
  type BoardFilterState,
} from "@/components/board/filters";
import {
  parseSavedStringList,
  savedKindForMode,
  modeForSavedKind,
  viewerScopedAssignees,
  type BoardViewMode,
  type SavedBoardView,
  type SavedBoardViewConfig,
} from "./board-saved";
import type { PersonScope } from "./contracts";

export type ViewSort = { columnKey: string; direction: "asc" | "desc" };

export interface ViewConditions {
  mode: BoardViewMode;
  assignees: readonly string[];
  byColumn: Readonly<Record<string, readonly string[]>>;
  sorts: readonly ViewSort[];
  groupBy: string;
  /** null = 모든 칸. 비교를 위해 정렬·중복 제거한 집합이다(보이는 칸의 «순서» 는 보드 칸 순서를 따른다). */
  visibleColumnKeys: readonly string[] | null;
}

/** 메인 테이블의 기준 — 아무 조건이 없는 표. */
export const MAIN_TABLE_CONDITIONS: ViewConditions = {
  mode: "table",
  assignees: [],
  byColumn: {},
  sorts: [],
  groupBy: "",
  visibleColumnKeys: null,
};

/** 걸린 정렬 — 여러 개(sorts)가 정본이고, 예전 저장값의 sortKey 하나도 읽는다. */
export function effectiveSorts(filters: Pick<BoardFilterState, "sorts" | "sortKey" | "sortDir">): ViewSort[] {
  if (filters.sorts?.length) return filters.sorts.map((sort) => ({ columnKey: sort.columnKey, direction: sort.direction }));
  return filters.sortKey ? [{ columnKey: filters.sortKey, direction: filters.sortDir }] : [];
}

function normalizeVisible(
  keys: readonly string[] | null | undefined,
  allColumnKeys?: readonly string[],
): readonly string[] | null {
  if (keys === null || keys === undefined) return null;
  const known = allColumnKeys ? new Set(allColumnKeys) : null;
  const picked = [...new Set(keys)].filter((key) => known === null || known.has(key)).sort();
  if (allColumnKeys && allColumnKeys.length > 0 && allColumnKeys.every((key) => picked.includes(key))) return null;
  return picked;
}

export function conditionsFromFilters(
  filters: BoardFilterState,
  mode: BoardViewMode,
  groupBy: string,
  allColumnKeys?: readonly string[],
): ViewConditions {
  const canonical = canonicalBoardFilters(filters);
  return {
    mode,
    assignees: canonical.assignees,
    byColumn: canonical.byColumn,
    sorts: effectiveSorts(filters),
    groupBy: groupBy ?? "",
    visibleColumnKeys: normalizeVisible(filters.visibleColumnKeys, allColumnKeys),
  };
}

/** 저장된 뷰의 설정(화면 key 로 바꾼 것) → 비교할 보기 조건. 검색어(q)·칸 순서·표시 방식은 들어가지 않는다. */
export function conditionsFromSavedConfig(
  config: SavedBoardViewConfig,
  allColumnKeys?: readonly string[],
): ViewConditions {
  return conditionsFromFilters(
    { ...config.filters, sorts: config.sorts.length ? [...config.sorts] : config.filters.sorts },
    modeForSavedKind(config.kind),
    config.groupBy,
    allColumnKeys,
  );
}

/**
 * 저장된 나눠 보기 → 이 화면이 «걸 수 있는» 값. 못 걸면 보드별("").
 * 목록·캘린더는 나눠 보기가 없고, 지운·숨긴·종류가 바뀐 칸도 못 건다. 신규리드는 저장값(physical)과
 * 화면 key(합성)가 다를 수 있어 후보를 차례로 맞춰 본다. 못 거는 값을 견주면 열자마자 «바뀜» 이고,
 * 되돌려도 같은 자리로 돌아온다.
 */
export function applicableGroupBy(
  candidates: readonly (string | null | undefined)[],
  groupByKeys: readonly string[],
): string {
  return candidates.find((key): key is string => Boolean(key) && groupByKeys.includes(key as string)) ?? "";
}

/**
 * 저장된 뷰 → 이 화면에서 견줄 기준 조건.
 *   · 나눠 보기는 이 화면이 걸 수 있는 값으로(applicableGroupBy).
 *   · 보는 사람 기준(viewer) 뷰의 담당은 «나»(D26 — viewerScopedAssignees).
 */
export function conditionsFromSavedView(
  view: Pick<SavedBoardView, "config" | "personScope">,
  screen: {
    allColumnKeys?: readonly string[];
    /** 이 화면이 걸 수 있는 나눠 보기 칸. 목록·캘린더는 비어 있다. */
    groupByKeys: readonly string[];
    /** 같은 뷰가 저장값으로 든 나눠 보기(신규리드 physical key). 화면 key 가 다를 때 이어서 맞춰 본다. */
    groupByAliases?: readonly string[];
    currentUserId?: string | null;
  },
): ViewConditions {
  return {
    ...conditionsFromSavedConfig(view.config, screen.allColumnKeys),
    assignees: [...new Set(viewerScopedAssignees(view, screen.currentUserId))].sort(),
    groupBy: applicableGroupBy([view.config.groupBy, ...(screen.groupByAliases ?? [])], screen.groupByKeys),
  };
}

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * 기준(저장된 뷰 또는 메인 테이블)과 지금 조건의 차이. 하나하나가 «바뀐 조건 1개» 다.
 * 필터는 칸마다 하나로 센다. 검색어와 칸 순서는 여기 들어오지 않는다(위 conditionsFrom* 가 이미 뺐다).
 */
export function changedConditions(current: ViewConditions, baseline: ViewConditions): string[] {
  const changes: string[] = [];
  if (current.mode !== baseline.mode) changes.push("mode");
  if (!sameList(current.assignees, baseline.assignees)) changes.push("assignees");
  const filterKeys = [...new Set([...Object.keys(current.byColumn), ...Object.keys(baseline.byColumn)])].sort();
  for (const key of filterKeys) {
    if (!sameList(current.byColumn[key] ?? [], baseline.byColumn[key] ?? [])) changes.push(`filter:${key}`);
  }
  const sortKey = (sorts: readonly ViewSort[]) => sorts.map((sort) => `${sort.columnKey}:${sort.direction}`);
  if (!sameList(sortKey(current.sorts), sortKey(baseline.sorts))) changes.push("sorts");
  if (current.groupBy !== baseline.groupBy) changes.push("groupBy");
  const visible = (keys: readonly string[] | null) => keys === null ? ["*"] : keys;
  if (!sameList(visible(current.visibleColumnKeys), visible(baseline.visibleColumnKeys))) changes.push("columns");
  return changes;
}

/** 탭의 점에 붙는 짧은 풀이. */
export function changedConditionsLabel(count: number): string {
  return `바뀐 조건 ${count}개`;
}

/** 기준 조건을 지금 필터 모양으로 — 「되돌리기」 가 같은 보기 방식 안에서 제자리로 돌릴 때 쓴다. 검색어는 지금 것을 둔다. */
export function filtersForConditions(baseline: ViewConditions, current: BoardFilterState): BoardFilterState {
  return canonicalBoardFilters({
    ...current,
    assignees: [...baseline.assignees],
    byColumn: Object.fromEntries(Object.entries(baseline.byColumn).map(([key, picked]) => [key, [...picked]])),
    sortKey: "",
    sortDir: "asc",
    sorts: baseline.sorts.map((sort) => ({ ...sort })),
    columnLimit: 0,
    visibleColumnKeys: baseline.visibleColumnKeys === null ? null : [...baseline.visibleColumnKeys],
  });
}

/* ── 칩·건수 글자 ─────────────────────────────────────────────────────────── */

export const VIEW_MODE_LABEL: Readonly<Record<BoardViewMode, string>> = {
  table: "표",
  kanban: "칸반",
  flat: "목록",
  calendar: "캘린더",
};

type Person = { value: string; label: string };

/** 「담당 · 전체|나|이름|N명」 의 값 부분. */
export function assigneeChipValue(
  assignees: readonly string[],
  people: readonly Person[],
  currentUserId?: string | null,
): string {
  if (assignees.length === 0) return "전체";
  if (assignees.length > 1) return `${assignees.length}명`;
  const only = assignees[0];
  if (currentUserId && only === currentUserId) return "나";
  if (only === UNASSIGNED) return "없음";
  return people.find((person) => person.value === only)?.label ?? "1명";
}

/** 필터에 걸린 칸 수(담당 제외). */
export function pickedFilterCount(filters: Pick<BoardFilterState, "byColumn">): number {
  return Object.values(filters.byColumn).filter((picked) => picked.length > 0).length;
}

/**
 * 건수 글자 — 「내 담당 · 40건 중 6건」. 조건으로 줄어든 행이 «조용히» 사라지지 않게 늘 보인다.
 * 요약은 짧게: 담당 · 필터 N · 찾기. 아무것도 안 걸리면 「40건」.
 */
export function viewCountText({
  filters,
  people,
  currentUserId,
  matched,
  total,
}: {
  filters: Pick<BoardFilterState, "assignees" | "byColumn" | "q">;
  people: readonly Person[];
  currentUserId?: string | null;
  matched: number;
  total: number;
}): string {
  const parts: string[] = [];
  const assignees = [...new Set(filters.assignees)];
  if (assignees.length === 1) {
    const value = assigneeChipValue(assignees, people, currentUserId);
    parts.push(value === "나" ? "내 담당" : value === "없음" ? "담당 없음" : `${value} 담당`);
  } else if (assignees.length > 1) {
    parts.push(`담당 ${assignees.length}명`);
  }
  const picked = pickedFilterCount(filters);
  if (picked > 0) parts.push(`필터 ${picked}`);
  const query = filters.q.trim();
  if (query) parts.push(`찾기 “${query.length > 12 ? `${query.slice(0, 12)}…` : query}”`);
  parts.push(matched === total ? `${total}건` : `${total}건 중 ${matched}건`);
  return parts.join(" · ");
}

/* ── 저장할 설정 ──────────────────────────────────────────────────────────── */

/**
 * 지금 보기 조건 → 저장할 뷰 설정(화면 key). 검색어(q)는 빼고, 칸 순서(layout)는 담지 않는다.
 * 숨김·목록 칸 순서·글자 방식·강조 칸·캘린더 날짜 칸은 주소에 있으면 주소 것, 없으면 지금 뷰의 것을 그대로 잇는다.
 */
export function draftViewConfig({
  mode,
  filters,
  groupBy,
  params,
  active,
  defaultCalendarFieldKey = null,
}: {
  mode: BoardViewMode;
  filters: BoardFilterState;
  groupBy: string;
  params: URLSearchParams;
  active: SavedBoardViewConfig | null;
  defaultCalendarFieldKey?: string | null;
}): SavedBoardViewConfig {
  const sorts = effectiveSorts(filters);
  return {
    kind: savedKindForMode(mode),
    filters: canonicalBoardFilters({
      ...filters,
      q: "",
      sortKey: "",
      sortDir: "asc",
      sorts,
      columnLimit: 0,
      visibleColumnKeys: filters.visibleColumnKeys ?? null,
    }),
    groupBy,
    layout: {},
    hiddenColumns: params.has("mwHidden")
      ? parseSavedStringList(params.get("mwHidden") ?? undefined)
      : active?.hiddenColumns ?? [],
    columnOrder: params.has("mwOrder")
      ? parseSavedStringList(params.get("mwOrder") ?? undefined)
      : active?.columnOrder ?? [],
    calendarFieldKey: params.get("calendarField") || active?.calendarFieldKey || defaultCalendarFieldKey || null,
    sorts,
    textMode: params.has("mwText")
      ? (params.get("mwText") === "wrap" ? "wrap" : "single")
      : active?.textMode ?? "single",
    focusColumnKey: params.has("mwFocus") ? (params.get("mwFocus") || null) : active?.focusColumnKey ?? null,
  };
}

/**
 * 저장할 사람 범위 — D26: 사람 조건은 동적이 기본이다.
 * 담당이 「나」 하나뿐이면 보는 사람 기준(viewer)으로 담고 id 는 뺀다 — 팀 뷰를 연 다른 사람에게는 그 사람의 행이 보인다.
 * 「나」 로 담겨 있던 뷰에서 담당을 바꿨으면 viewer 를 풀고, 팀·고정 범위는 그대로 잇는다.
 */
export function draftPersonScope(
  config: SavedBoardViewConfig,
  active: (Pick<SavedBoardView, "personScope" | "personScopeUserId"> & { config: Pick<SavedBoardViewConfig, "filters"> }) | null,
  currentUserId?: string | null,
): { config: SavedBoardViewConfig; personScope: PersonScope; personScopeUserId: string | null } {
  const assignees = config.filters.assignees;
  if (currentUserId && assignees.length === 1 && assignees[0] === currentUserId) {
    return { config: { ...config, filters: { ...config.filters, assignees: [] } }, personScope: "viewer", personScopeUserId: null };
  }
  const scope = active?.personScope ?? "none";
  if (scope === "viewer" && active?.config.filters.assignees.length === 0) {
    return { config, personScope: "none", personScopeUserId: null };
  }
  return { config, personScope: scope, personScopeUserId: scope === "fixed" ? active?.personScopeUserId ?? null : null };
}

/** 주소의 mwFilters 에 지금 검색어를 다시 넣는다 — 뷰를 바꾸거나 되돌려도 찾던 글자는 남긴다. */
export function withSearchText(url: string, q: string): string {
  if (!q.trim()) return url;
  const next = new URL(url);
  const filters = decodeBoardFilters(next.searchParams.get(BOARD_FILTER_QUERY_KEY));
  next.searchParams.set(BOARD_FILTER_QUERY_KEY, encodeBoardFilters({ ...filters, q }));
  return next.toString();
}
