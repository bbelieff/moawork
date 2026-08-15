"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { applyFilters, BOARD_FILTER_QUERY_KEY, decodeBoardFilters, type BoardFilterState } from "@/components/board/filters";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";
import { formatCell } from "@/lib/boards/cells";
import { DEFAULT_SYSTEM_VIEW, isSystemView, type NewTabViewInput, type ResolvedView, type TabView, type ViewKind } from "@/lib/view";
import { savedViewUrl, type SavedBoardView, type SavedBoardViewConfig } from "@/lib/view/board-saved";
import { CalendarView } from "./CalendarView";
import { SaveViewDialog } from "./SaveViewDialog";
import { TableView, type TableColumn } from "./TableView";
import { ViewPicker } from "./ViewPicker";
import { ViewTabs } from "./ViewTabs";

type SaveEvent = CustomEvent<{ version?: number; filters?: BoardFilterState }>;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "저장된 뷰를 불러오지 못했습니다.");
  return payload.data as T;
}

function kindOf(config: SavedBoardViewConfig): ViewKind {
  return config.kind === "calendar" ? "cal" : config.kind === "table" ? "flat" : "board";
}

function toTabView(view: SavedBoardView, orgId: string, boardId: string): TabView {
  return {
    id: view.id, orgId, boardKey: boardId, ownerId: view.ownerId, name: view.name,
    kind: kindOf(view.config), visibility: view.visibility, personScope: "viewer", personScopeUserId: null,
    filters: view.config.filters.byColumn,
    sort: view.config.filters.sortKey ? [{ columnKey: view.config.filters.sortKey, direction: view.config.filters.sortDir }] : [],
    hiddenColumns: view.config.hiddenColumns, columnOrder: view.config.columnOrder,
    calendarFieldKey: view.config.calendarFieldKey,
    createdAt: view.lastUsedAt ?? "1970-01-01T00:00:00.000Z", updatedAt: view.lastUsedAt ?? "1970-01-01T00:00:00.000Z",
  };
}

export function SavedViewsController({
  boardId, orgId, currentUserId, layout = {}, columns = [], rows = [], renderMode = "controls",
}: {
  boardId: string; orgId: string; currentUserId: string;
  layout?: Record<string, readonly string[]>; columns?: readonly BoardColumn[]; rows?: readonly ItemWithValues[];
  renderMode?: "controls" | "flat" | "calendar";
}) {
  const [views, setViews] = useState<SavedBoardView[]>([]);
  const [pending, setPending] = useState<SavedBoardViewConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const reload = useCallback(async () => {
    try { setViews(await request(`/api/tab-views?boardId=${encodeURIComponent(boardId)}`)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장된 뷰를 불러오지 못했습니다."); }
  }, [boardId]);
  useEffect(() => {
    request<SavedBoardView[]>(`/api/tab-views?boardId=${encodeURIComponent(boardId)}`)
      .then((loaded) => { setViews(loaded); setError(null); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "저장된 뷰를 불러오지 못했습니다."));
  }, [boardId]);

  const activeId = typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("savedView");
  const activeSaved = views.find((view) => view.id === activeId) ?? null;
  const activeKind: ViewKind = activeSaved ? kindOf(activeSaved.config) : renderMode === "calendar" ? "cal" : renderMode === "flat" ? "flat" : "board";
  const current: ResolvedView = activeSaved ? toTabView(activeSaved, orgId, boardId) : { ...DEFAULT_SYSTEM_VIEW, kind: activeKind };

  const currentConfig = useCallback((filters?: BoardFilterState): SavedBoardViewConfig => {
    const url = new URL(window.location.href);
    return {
      kind: activeKind === "cal" ? "calendar" : activeKind === "flat" ? "table" : "board",
      filters: filters ?? decodeBoardFilters(url.searchParams.get(BOARD_FILTER_QUERY_KEY)),
      groupBy: url.searchParams.get("group") ?? "", layout,
      hiddenColumns: activeSaved?.config.hiddenColumns ?? [],
      columnOrder: activeSaved?.config.columnOrder ?? Object.values(layout).flat(),
      calendarFieldKey: activeSaved?.config.calendarFieldKey ?? columns.find((column) => column.type === "date")?.key ?? null,
    };
  }, [activeKind, activeSaved, columns, layout]);

  useEffect(() => {
    const onSave = (event: Event) => setPending(currentConfig((event as SaveEvent).detail?.filters));
    window.addEventListener("moawork:save-board-view", onSave);
    return () => window.removeEventListener("moawork:save-board-view", onSave);
  }, [currentConfig]);

  const selectSystem = (kind: ViewKind) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("savedView");
    url.searchParams.set("view", kind === "board" ? "kanban" : kind === "cal" ? "calendar" : "flat");
    window.location.assign(url.toString());
  };
  const selectResolved = (view: ResolvedView) => {
    if (isSystemView(view)) return selectSystem(view.kind);
    const saved = views.find((candidate) => candidate.id === view.id);
    if (saved) window.location.assign(savedViewUrl(saved, window.location.href));
  };
  const create = async (input: NewTabViewInput) => {
    if (!pending) return;
    await request("/api/tab-views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      boardId, name: input.name, visibility: input.visibility,
      config: { ...pending, kind: input.kind === "cal" ? "calendar" : input.kind === "flat" ? "table" : "board", calendarFieldKey: input.calendarFieldKey },
    }) });
    setPending(null); await reload();
  };

  const config = activeSaved?.config ?? currentConfig();
  const filteredRows = useMemo(() => applyFilters(rows, columns, config.filters), [rows, columns, config.filters]);
  const orderedColumns = useMemo(() => {
    const hidden = new Set(config.hiddenColumns);
    const rank = new Map(config.columnOrder.map((key, index) => [key, index]));
    return columns.filter((column) => !hidden.has(column.key)).sort((a, b) => (rank.get(a.key) ?? 1e6) - (rank.get(b.key) ?? 1e6));
  }, [columns, config.hiddenColumns, config.columnOrder]);
  const tableColumns: TableColumn[] = [{ key: "__title", label: "아이템" }, ...orderedColumns.map((column) => ({ key: column.key, label: column.label }))];
  const dateColumn = columns.find((column) => column.key === config.calendarFieldKey) ?? columns.find((column) => column.type === "date");

  return (
    <section aria-label="저장된 뷰" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ViewTabs kind={activeKind} onSelect={selectSystem} />
        <ViewPicker views={views.map((view) => toTabView(view, orgId, boardId))} current={current} currentUserId={currentUserId} onSelect={selectResolved} onRequestSave={() => setPending(currentConfig())} />
        {error ? <span role="alert" className="text-xs text-mw-error">{error}</span> : null}
      </div>
      {pending ? <SaveViewDialog orgId={orgId} boardKey={boardId} ownerId={currentUserId} kind={kindOf(pending)} filters={pending.filters.byColumn} sort={pending.filters.sortKey ? [{ columnKey: pending.filters.sortKey, direction: pending.filters.sortDir }] : []} calendarFieldKey={pending.calendarFieldKey} onSubmit={(input) => void create(input)} onCancel={() => setPending(null)} /> : null}
      {renderMode === "flat" ? <TableView columns={tableColumns} rows={filteredRows} rowKey={(row) => row.id} renderCell={(row, column) => {
        if (column.key === "__title") return row.title;
        const definition = columns.find((candidate) => candidate.key === column.key);
        return definition ? formatCell(definition.type, row.values[definition.key] ?? null, definition.options_jsonb?.options) : "";
      }} /> : null}
      {renderMode === "calendar" ? <>
        {!dateColumn ? <p role="status" className="text-sm text-mw-sub">달력에 표시할 날짜 컬럼이 없습니다.</p> : null}
        <CalendarView rows={filteredRows} rowKey={(row) => row.id} dateOf={(row) => dateColumn && typeof row.values[dateColumn.key] === "string" ? row.values[dateColumn.key] as string : null} renderItem={(row) => <span className="text-xs">{row.title}</span>} year={now.getFullYear()} month={now.getMonth() + 1} />
      </> : null}
    </section>
  );
}
