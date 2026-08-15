import { applyFilters, encodeBoardFilters, type BoardFilterState } from "@/components/board/filters";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";

export type SavedBoardViewKind = "board" | "table" | "calendar";

export interface SavedBoardViewConfig {
  kind: SavedBoardViewKind;
  filters: BoardFilterState;
  groupBy: string;
  layout: Record<string, readonly string[]>;
  hiddenColumns: readonly string[];
  columnOrder: readonly string[];
  calendarFieldKey: string | null;
}

export interface SavedBoardView {
  id: string;
  name: string;
  visibility: "private" | "shared";
  ownerId: string;
  config: SavedBoardViewConfig;
  isDefault: boolean;
  lastUsedAt: string | null;
}

const EMPTY_FILTERS: BoardFilterState = {
  q: "",
  assignees: [],
  byColumn: {},
  sortKey: "",
  sortDir: "asc",
  columnLimit: 0,
};

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
    },
    groupBy: typeof root.groupBy === "string" ? root.groupBy : "",
    layout: Object.fromEntries(Object.entries(rawLayout).map(([key, order]) => [key, strings(order)])),
    hiddenColumns: strings(root.hiddenColumns),
    columnOrder: strings(root.columnOrder),
    calendarFieldKey: typeof root.calendarFieldKey === "string" ? root.calendarFieldKey : null,
  };
}

export function savedBoardViewFromRow(row: Record<string, unknown>): SavedBoardView {
  return {
    id: String(row.id), name: String(row.name),
    visibility: row.visibility === "shared" ? "shared" : "private",
    ownerId: String(row.owner_id), config: parseSavedBoardViewConfig(row.config_jsonb),
    isDefault: row.is_default === true,
    lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null,
  };
}

export function savedViewUrl(view: SavedBoardView, current: string): string {
  const url = new URL(current);
  url.searchParams.set("savedView", view.id);
  url.searchParams.set("view", view.config.kind === "board" ? "kanban" : view.config.kind === "calendar" ? "calendar" : "flat");
  url.searchParams.set("mwLayout", JSON.stringify(view.config.layout));
  url.searchParams.set("mwHidden", JSON.stringify(view.config.hiddenColumns));
  url.searchParams.set("mwOrder", JSON.stringify(view.config.columnOrder));
  url.searchParams.set("mwFilters", encodeBoardFilters(view.config.filters));
  if (view.config.groupBy) url.searchParams.set("group", view.config.groupBy);
  else url.searchParams.delete("group");
  return url.toString();
}

export function systemViewUrl(kind: "board" | "flat" | "cal", current: string): string {
  const url = new URL(current);
  for (const key of ["savedView", "mwFilters", "mwLayout", "mwHidden", "mwOrder", "group", "sort", "calendarField"]) {
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
