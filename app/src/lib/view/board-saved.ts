import { applyFilters, canonicalBoardFilters, encodeBoardFilters, type BoardFilterProjection, type BoardFilterState } from "@/components/board/filters";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";
import {
  durableNewLeadColumnKeys,
  newLeadPresentationKey,
  presentNewLeadColumnKeys,
} from "@/lib/default-tabs/new-lead";
import {
  compareNewLeadFinancialValues,
  newLeadFinancialSearchText,
} from "@/lib/new-lead/financial-profile";
import type { PersonScope } from "./contracts";

/**
 * 저장된 뷰의 보기 방식. 주소의 `view` 와 이름이 어긋나 있으니 아래 두 함수로만 바꾼다.
 *   grouped  = 표(그룹으로 묶인 메인 표, ?view=table) — #845 6단계에서 새로 생겼다.
 *   board    = 칸반(?view=kanban) — 예전 저장값. 표에서 저장해도 이 값이 들어가던 버그가 있었다.
 *   table    = 목록(묶지 않은 표, ?view=flat) — 예전 저장값.
 *   calendar = 캘린더(?view=calendar)
 */
export type SavedBoardViewKind = "grouped" | "board" | "table" | "calendar";

/** 주소의 보기 방식(`?view=`). 없으면 메인 표다. */
export type BoardViewMode = "table" | "kanban" | "flat" | "calendar";

export function parseBoardViewMode(value: string | null | undefined): BoardViewMode {
  return value === "kanban" || value === "flat" || value === "calendar" ? value : "table";
}

export function savedKindForMode(mode: BoardViewMode): SavedBoardViewKind {
  return mode === "kanban" ? "board" : mode === "flat" ? "table" : mode === "calendar" ? "calendar" : "grouped";
}

export function modeForSavedKind(kind: SavedBoardViewKind): BoardViewMode {
  return kind === "board" ? "kanban" : kind === "table" ? "flat" : kind === "calendar" ? "calendar" : "table";
}

/** tab_views.kind(정규화 열) — 표·칸반은 'board', 목록은 'flat', 캘린더는 'cal'. 읽을 때는 config_jsonb 가 정본이다. */
export function tabViewDbKind(kind: SavedBoardViewKind): "board" | "flat" | "cal" {
  return kind === "table" ? "flat" : kind === "calendar" ? "cal" : "board";
}

/**
 * 저장된 뷰를 덮어쓰거나(조건·이름·공개 범위) 지울 수 있는 사람 — 만든 사람, 그리고 워크스페이스 소유자·관리자.
 * 화면(「이 뷰에 저장」 표시)과 서버(PATCH·DELETE 거절)가 같은 규칙을 쓴다. RLS(072 tabviews_update/delete)도 같다.
 */
export function canOverwriteSavedView(
  view: { ownerId: string | null },
  viewer: { userId: string; role: string },
): boolean {
  return view.ownerId === viewer.userId || viewer.role === "owner" || viewer.role === "admin";
}

export interface SavedBoardViewConfig {
  kind: SavedBoardViewKind;
  filters: BoardFilterState;
  groupBy: string;
  layout: Record<string, readonly string[]>;
  hiddenColumns: readonly string[];
  columnOrder: readonly string[];
  calendarFieldKey: string | null;
  /** 우선순위 순 다중 정렬. legacy filters.sortKey/Dir도 계속 읽는다. */
  sorts: readonly { columnKey: string; direction: "asc" | "desc" }[];
  textMode: "single" | "wrap";
  focusColumnKey: string | null;
}

export interface SavedBoardView {
  id: string;
  name: string;
  visibility: "private" | "shared";
  ownerId: string;
  personScope?: PersonScope;
  personScopeUserId?: string | null;
  config: SavedBoardViewConfig;
  isDefault: boolean;
  lastUsedAt: string | null;
  canEdit?: boolean;
}

export const NEW_LEAD_SAVED_FILTER_PROJECTION: BoardFilterProjection = {
  searchText: (row, column) => newLeadFinancialSearchText(column.key, row.values),
  compareRows: (left, right, columnKey, direction) =>
    compareNewLeadFinancialValues(columnKey, left.values, right.values, direction),
};

type SavedSort = { columnKey: string; direction: "asc" | "desc" };

function presentSorts(values: readonly SavedSort[]): SavedSort[] {
  const seen = new Set<string>();
  return values.flatMap((sort) => {
    const columnKey = newLeadPresentationKey(sort.columnKey);
    if (seen.has(columnKey)) return [];
    seen.add(columnKey);
    return [{ ...sort, columnKey }];
  });
}

function durableSorts(values: readonly SavedSort[]): SavedSort[] {
  const seen = new Set<string>();
  return values.flatMap((sort) => durableNewLeadColumnKeys([sort.columnKey]).flatMap((columnKey) => {
    const identity = `${columnKey}:${sort.direction}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ ...sort, columnKey }];
  }));
}

/** API/URL에서 읽은 physical saved-view config를 신규리드 presentation 계약으로 바꾼다. */
export function presentNewLeadSavedFilters(filters: BoardFilterState): BoardFilterState {
  const filterSorts = presentSorts(filters.sorts ?? []);
  return {
    ...filters,
    // Facets are predicates over durable values. Aliasing them to a synthetic
    // cell would merge NCB/KCB predicates and erase their independent AND.
    byColumn: { ...filters.byColumn },
    sortKey: filters.sortKey ? newLeadPresentationKey(filters.sortKey) : "",
    sorts: filterSorts,
    visibleColumnKeys: presentNewLeadColumnKeys(filters.visibleColumnKeys),
  };
}

export function durableNewLeadSavedFilters(filters: BoardFilterState): BoardFilterState {
  const filterSorts = durableSorts(filters.sorts ?? []);
  return {
    ...filters,
    byColumn: { ...filters.byColumn },
    sortKey: filters.sortKey ? durableNewLeadColumnKeys([filters.sortKey])[0] ?? "" : "",
    sorts: filterSorts,
    visibleColumnKeys: filters.visibleColumnKeys == null
      ? filters.visibleColumnKeys
      : durableNewLeadColumnKeys(filters.visibleColumnKeys),
  };
}

/** API/URL에서 읽은 physical saved-view config를 신규리드 presentation 계약으로 바꾼다. */
export function presentNewLeadSavedViewConfig(config: SavedBoardViewConfig): SavedBoardViewConfig {
  const configSorts = presentSorts(config.sorts);
  return {
    ...config,
    filters: presentNewLeadSavedFilters(config.filters),
    groupBy: config.groupBy ? newLeadPresentationKey(config.groupBy) : "",
    layout: Object.fromEntries(Object.entries(config.layout).map(([groupId, keys]) => [
      groupId,
      presentNewLeadColumnKeys(keys) ?? [],
    ])),
    hiddenColumns: presentNewLeadColumnKeys(config.hiddenColumns) ?? [],
    columnOrder: presentNewLeadColumnKeys(config.columnOrder) ?? [],
    calendarFieldKey: config.calendarFieldKey ? newLeadPresentationKey(config.calendarFieldKey) : null,
    sorts: configSorts,
    focusColumnKey: config.focusColumnKey ? newLeadPresentationKey(config.focusColumnKey) : null,
  };
}

/** presentation config를 API 저장 직전에 양쪽 durable sibling으로 무손실 확장한다. */
export function durableNewLeadSavedViewConfig(config: SavedBoardViewConfig): SavedBoardViewConfig {
  const configSorts = durableSorts(config.sorts);
  return {
    ...config,
    filters: durableNewLeadSavedFilters(config.filters),
    groupBy: config.groupBy ? durableNewLeadColumnKeys([config.groupBy])[0] ?? "" : "",
    layout: Object.fromEntries(Object.entries(config.layout).map(([groupId, keys]) => [
      groupId,
      durableNewLeadColumnKeys(keys),
    ])),
    hiddenColumns: durableNewLeadColumnKeys(config.hiddenColumns),
    columnOrder: durableNewLeadColumnKeys(config.columnOrder),
    calendarFieldKey: config.calendarFieldKey ? durableNewLeadColumnKeys([config.calendarFieldKey])[0] ?? null : null,
    sorts: configSorts,
    focusColumnKey: config.focusColumnKey ? durableNewLeadColumnKeys([config.focusColumnKey])[0] ?? null : null,
  };
}

const EMPTY_FILTERS: BoardFilterState = {
  q: "",
  assignees: [],
  byColumn: {},
  sortKey: "",
  sortDir: "asc",
  columnLimit: 0,
  visibleColumnKeys: null,
};

function sorts(value: unknown): Array<{ columnKey: string; direction: "asc" | "desc" }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    return typeof row.columnKey === "string" && row.columnKey !== ""
      && (row.direction === "asc" || row.direction === "desc")
      ? [{ columnKey: row.columnKey, direction: row.direction }]
      : [];
  });
}

export function parsePersonScopeInput(value: unknown, fixedUserId: unknown): {
  personScope: PersonScope; personScopeUserId: string | null;
} {
  const personScope: PersonScope = value === "none" || value === "team" || value === "fixed" ? value : "viewer";
  const personScopeUserId = personScope === "fixed" && typeof fixedUserId === "string" && fixedUserId.trim() ? fixedUserId.trim() : null;
  if (personScope === "fixed" && !personScopeUserId) throw new Error("fixed person scope requires a user");
  return { personScope, personScopeUserId };
}

export function applySavedPersonScope(
  rows: readonly ItemWithValues[],
  view: Pick<SavedBoardView, "personScope" | "personScopeUserId"> | null,
  currentUserId: string,
  personColumnKey: string | null,
  teamMemberIds: readonly string[] = [],
  canonicalNewLead = false,
): ItemWithValues[] {
  if (!view || !view.personScope || view.personScope === "none") return [...rows];
  const expected = view.personScope === "fixed"
    ? (view.personScopeUserId && teamMemberIds.includes(view.personScopeUserId) ? [view.personScopeUserId] : [])
    : view.personScope === "team" ? teamMemberIds : teamMemberIds.includes(currentUserId) ? [currentUserId] : [];
  if (!expected.length) return [];
  return rows.filter((row) => {
    // Canonical lead ownership lives on the item; its EAV projection may be absent or stale.
    const value = personColumnKey && !(canonicalNewLead && personColumnKey === "owner")
      ? row.values[personColumnKey] : row.assigned_to;
    return typeof value === "string"
      ? expected.includes(value)
      : Array.isArray(value) && value.some((memberId) => typeof memberId === "string" && expected.includes(memberId));
  });
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseSavedBoardViewConfig(value: unknown): SavedBoardViewConfig {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawFilters = root.filters && typeof root.filters === "object"
    ? root.filters as Record<string, unknown>
    : {};
  const byColumn = rawFilters.byColumn && typeof rawFilters.byColumn === "object"
    ? Object.fromEntries(Object.entries(rawFilters.byColumn as Record<string, unknown>).map(([key, picked]) => [key, strings(picked)]))
    : {};
  const rawLayout = root.layout && typeof root.layout === "object"
    ? root.layout as Record<string, unknown>
    : {};
  const kind: SavedBoardViewKind = root.kind === "grouped" || root.kind === "table" || root.kind === "calendar" ? root.kind : "board";
  const parsedSorts = sorts(root.sorts);
  const legacySorts = typeof rawFilters.sortKey === "string" && rawFilters.sortKey
    ? [{ columnKey: rawFilters.sortKey, direction: rawFilters.sortDir === "desc" ? "desc" as const : "asc" as const }]
    : [];
  return {
    kind,
    filters: canonicalBoardFilters({
      ...EMPTY_FILTERS,
      q: typeof rawFilters.q === "string" ? rawFilters.q : "",
      assignees: strings(rawFilters.assignees),
      byColumn,
      sortKey: typeof rawFilters.sortKey === "string" ? rawFilters.sortKey : "",
      sortDir: rawFilters.sortDir === "desc" ? "desc" : "asc",
      columnLimit: 0,
      visibleColumnKeys: Array.isArray(rawFilters.visibleColumnKeys)
        ? strings(rawFilters.visibleColumnKeys)
        : null,
      sorts: parsedSorts.length ? parsedSorts : legacySorts,
    }),
    groupBy: typeof root.groupBy === "string" ? root.groupBy : "",
    layout: Object.fromEntries(Object.entries(rawLayout).map(([key, order]) => [key, strings(order)])),
    hiddenColumns: strings(root.hiddenColumns),
    columnOrder: strings(root.columnOrder),
    calendarFieldKey: typeof root.calendarFieldKey === "string" ? root.calendarFieldKey : null,
    sorts: parsedSorts.length ? parsedSorts : legacySorts,
    textMode: root.textMode === "wrap" ? "wrap" : "single",
    focusColumnKey: typeof root.focusColumnKey === "string" ? root.focusColumnKey : null,
  };
}

export function savedBoardViewFromRow(row: Record<string, unknown>, canEdit?: boolean): SavedBoardView {
  return {
    id: String(row.id), name: String(row.name),
    visibility: row.visibility === "shared" ? "shared" : "private",
    ownerId: String(row.owner_id), config: parseSavedBoardViewConfig(row.config_jsonb),
    ...parsePersonScopeInput(row.person_scope, row.person_scope_user_id),
    isDefault: row.is_default === true,
    lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null,
    ...(canEdit === undefined ? {} : { canEdit }),
  };
}

/**
 * D26 — 보는 사람 기준(viewer) 뷰의 담당 조건. 뷰에는 사람 id 를 박지 않으므로, 담당이 비어 있으면 «보는 사람» 이다.
 * 담당 칩이 「나」 로 서고, 연 그대로는 «바뀜» 이 아니다.
 */
export function viewerScopedAssignees(
  view: Pick<SavedBoardView, "personScope"> & { config: Pick<SavedBoardViewConfig, "filters"> },
  viewerId?: string | null,
): string[] {
  const saved = view.config.filters.assignees;
  return view.personScope === "viewer" && viewerId && saved.length === 0 ? [viewerId] : [...saved];
}

/** 저장된 뷰를 여는 주소. viewerId 를 주면 보는 사람 기준 뷰의 담당을 그 사람으로 채운다(viewerScopedAssignees). */
export function savedViewUrl(view: SavedBoardView, current: string, viewerId?: string | null): string {
  const url = new URL(current);
  url.searchParams.set("savedView", view.id);
  url.searchParams.set("view", modeForSavedKind(view.config.kind));
  // 칸 순서는 보드 전체의 것이다(#845 6단계) — 예전 뷰가 품은 layout 은 읽기만 하고 화면에 덮어쓰지 않는다.
  url.searchParams.delete("mwLayout");
  url.searchParams.set("mwHidden", JSON.stringify(view.config.hiddenColumns));
  url.searchParams.set("mwOrder", JSON.stringify(view.config.columnOrder));
  url.searchParams.set("mwFilters", encodeBoardFilters({
    ...view.config.filters,
    assignees: viewerScopedAssignees(view, viewerId),
    sorts: [...view.config.sorts],
  }));
  url.searchParams.set("mwSort", JSON.stringify(view.config.sorts));
  url.searchParams.set("mwText", view.config.textMode);
  if (view.config.focusColumnKey) url.searchParams.set("mwFocus", view.config.focusColumnKey);
  else url.searchParams.delete("mwFocus");
  if (view.config.groupBy) url.searchParams.set("group", view.config.groupBy);
  else url.searchParams.delete("group");
  // 캘린더 날짜 칸도 이 뷰의 것으로 — 앞 뷰의 칸이 주소에 남아 다음 뷰를 덮지 않게.
  if (view.config.calendarFieldKey) url.searchParams.set("calendarField", view.config.calendarFieldKey);
  else url.searchParams.delete("calendarField");
  return url.toString();
}

export function systemViewUrl(kind: "table" | "board" | "flat" | "cal", current: string): string {
  const url = new URL(current);
  for (const key of ["savedView", "mwFilters", "mwLayout", "mwHidden", "mwOrder", "mwSort", "mwText", "mwFocus", "group", "sort", "calendarField"]) {
    url.searchParams.delete(key);
  }
  url.searchParams.set("view", kind === "table" ? "table" : kind === "board" ? "kanban" : kind === "cal" ? "calendar" : "flat");
  return url.toString();
}

export function boardViewSwitchUrl(
  kind: BoardViewMode,
  current: string,
  groupBy?: string,
): string {
  const url = new URL(current);
  url.searchParams.set("view", kind);
  if (groupBy === undefined) {
    // Keep the current grouping while changing only the renderer.
  } else if (groupBy) {
    url.searchParams.set("group", groupBy);
  } else {
    url.searchParams.delete("group");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function applySavedKanbanView<T extends { items: readonly ItemWithValues[] }>(
  lanes: readonly T[], rows: readonly ItemWithValues[], columns: readonly BoardColumn[], filters: BoardFilterState,
  projection?: BoardFilterProjection,
  /** 사람 id → 이름. 사람 칸 「이름순」 이 id 순이 되지 않게. */
  assigneeLabels?: Readonly<Record<string, string>>,
): Array<T & { items: ItemWithValues[] }> {
  const filtered = applyFilters(rows, columns, filters, projection, assigneeLabels);
  const rank = new Map(filtered.map((item, index) => [item.id, index]));
  return lanes.map((lane) => ({
    ...lane,
    items: lane.items.filter((item) => rank.has(item.id)).sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)),
  }));
}

export function parseSavedStringList(value: string | undefined): readonly string[] {
  if (!value) return [];
  try { return strings(JSON.parse(value)); } catch { return []; }
}

export function parseSavedBoardLayout(value: string | undefined): Record<string, readonly string[]> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, order]) => [key, strings(order)]));
  } catch {
    return null;
  }
}
