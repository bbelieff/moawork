import { applyFilters, encodeBoardFilters, type BoardFilterState } from "@/components/board/filters";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";
import type { PersonScope } from "./contracts";

export type SavedBoardViewKind = "board" | "table" | "calendar";

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

const EMPTY_FILTERS: BoardFilterState = {
  q: "",
  assignees: [],
  byColumn: {},
  sortKey: "",
  sortDir: "asc",
  columnLimit: 0,
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
): ItemWithValues[] {
  if (!view || !view.personScope || view.personScope === "none") return [...rows];
  const expected = view.personScope === "fixed"
    ? (view.personScopeUserId && teamMemberIds.includes(view.personScopeUserId) ? [view.personScopeUserId] : [])
    : view.personScope === "team" ? teamMemberIds : teamMemberIds.includes(currentUserId) ? [currentUserId] : [];
  if (!expected.length) return [];
  return rows.filter((row) => {
    const value = personColumnKey ? row.values[personColumnKey] : row.assigned_to;
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
  const kind = root.kind === "table" || root.kind === "calendar" ? root.kind : "board";
  const parsedSorts = sorts(root.sorts);
  const legacySorts = typeof rawFilters.sortKey === "string" && rawFilters.sortKey
    ? [{ columnKey: rawFilters.sortKey, direction: rawFilters.sortDir === "desc" ? "desc" as const : "asc" as const }]
    : [];
  return {
    kind,
    filters: {
      ...EMPTY_FILTERS,
      q: typeof rawFilters.q === "string" ? rawFilters.q : "",
      assignees: strings(rawFilters.assignees),
      byColumn,
      sortKey: typeof rawFilters.sortKey === "string" ? rawFilters.sortKey : "",
      sortDir: rawFilters.sortDir === "desc" ? "desc" : "asc",
      columnLimit: typeof rawFilters.columnLimit === "number" && Number.isFinite(rawFilters.columnLimit)
        ? Math.max(0, Math.floor(rawFilters.columnLimit))
        : 0,
      sorts: parsedSorts.length ? parsedSorts : legacySorts,
    },
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

export function savedViewUrl(view: SavedBoardView, current: string): string {
  const url = new URL(current);
  url.searchParams.set("savedView", view.id);
  url.searchParams.set("view", view.config.kind === "board" ? "kanban" : view.config.kind === "calendar" ? "calendar" : "flat");
  url.searchParams.set("mwLayout", JSON.stringify(view.config.layout));
  url.searchParams.set("mwHidden", JSON.stringify(view.config.hiddenColumns));
  url.searchParams.set("mwOrder", JSON.stringify(view.config.columnOrder));
  url.searchParams.set("mwFilters", encodeBoardFilters({ ...view.config.filters, sorts: [...view.config.sorts] }));
  url.searchParams.set("mwSort", JSON.stringify(view.config.sorts));
  url.searchParams.set("mwText", view.config.textMode);
  if (view.config.focusColumnKey) url.searchParams.set("mwFocus", view.config.focusColumnKey);
  else url.searchParams.delete("mwFocus");
  if (view.config.groupBy) url.searchParams.set("group", view.config.groupBy);
  else url.searchParams.delete("group");
  return url.toString();
}

export function systemViewUrl(kind: "board" | "flat" | "cal", current: string): string {
  const url = new URL(current);
  for (const key of ["savedView", "mwFilters", "mwLayout", "mwHidden", "mwOrder", "mwSort", "mwText", "mwFocus", "group", "sort", "calendarField"]) {
    url.searchParams.delete(key);
  }
  url.searchParams.set("view", kind === "board" ? "kanban" : kind === "cal" ? "calendar" : "flat");
  return url.toString();
}

export function applySavedKanbanView<T extends { items: readonly ItemWithValues[] }>(
  lanes: readonly T[], rows: readonly ItemWithValues[], columns: readonly BoardColumn[], filters: BoardFilterState,
): Array<T & { items: ItemWithValues[] }> {
  const filtered = applyFilters(rows, columns, filters);
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
