"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { applyFilters, BOARD_FILTER_QUERY_KEY, decodeBoardFilters, type BoardFilterState } from "@/components/board/filters";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";
import { type NewTabViewInput, type ViewKind } from "@/lib/view";
import {
  applySavedPersonScope,
  durableNewLeadSavedViewConfig,
  NEW_LEAD_SAVED_FILTER_PROJECTION,
  parseSavedStringList,
  presentNewLeadSavedFilters,
  presentNewLeadSavedViewConfig,
  savedViewUrl,
  systemViewUrl,
  type SavedBoardView,
  type SavedBoardViewConfig,
} from "@/lib/view/board-saved";
import { CalendarView } from "./CalendarView";
import { SaveViewDialog } from "./SaveViewDialog";
import { TableView, type TableColumn } from "./TableView";
import { ViewPicker } from "./ViewPicker";
import { ViewTabs } from "./ViewTabs";
import { BoardCell } from "@/components/board/GroupTable";
import { newLeadPresentationKey, presentNewLeadColumnKeys, presentNewLeadColumns } from "@/lib/default-tabs/new-lead";

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

export function SavedViewsController({
  boardId, orgId, currentUserId, teamMemberIds = [], layout = {}, columns = [], rows = [], renderMode = "controls", canEditItems = false,
  canonicalNewLead = false, memberOptions = [],
}: {
  boardId: string; orgId: string; currentUserId: string;
  teamMemberIds?: readonly string[];
  layout?: Record<string, readonly string[]>; columns?: readonly BoardColumn[]; rows?: readonly ItemWithValues[];
  renderMode?: "controls" | "flat" | "calendar";
  canEditItems?: boolean;
  canonicalNewLead?: boolean;
  memberOptions?: readonly { id: string; label: string }[];
}) {
  const [views, setViews] = useState<SavedBoardView[]>([]);
  const [pending, setPending] = useState<SavedBoardViewConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  useEffect(() => {
    request<SavedBoardView[]>(`/api/tab-views?boardId=${encodeURIComponent(boardId)}`)
      .then((loaded) => { setViews(loaded); setError(null); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "저장된 뷰를 불러오지 못했습니다."));
  }, [boardId]);

  const displayColumns = useMemo(
    () => canonicalNewLead ? presentNewLeadColumns(columns) : [...columns],
    [canonicalNewLead, columns],
  );
  const displayLayout = useMemo(
    () => canonicalNewLead
      ? Object.fromEntries(Object.entries(layout).map(([groupId, keys]) => [groupId, presentNewLeadColumnKeys(keys) ?? []]))
      : layout,
    [canonicalNewLead, layout],
  );
  const displayViews = useMemo(
    () => canonicalNewLead
      ? views.map((view) => ({ ...view, config: presentNewLeadSavedViewConfig(view.config) }))
      : views,
    [canonicalNewLead, views],
  );

  const activeId = typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("savedView");
  const activeSaved = displayViews.find((view) => view.id === activeId) ?? null;
  const activeKind: ViewKind = activeSaved ? kindOf(activeSaved.config) : renderMode === "calendar" ? "cal" : renderMode === "flat" ? "flat" : "board";

  const currentConfig = useCallback((filtersOverride?: BoardFilterState): SavedBoardViewConfig => {
    const url = new URL(typeof window === "undefined" ? "http://localhost" : window.location.href);
    const rawFilters = filtersOverride ?? decodeBoardFilters(url.searchParams.get(BOARD_FILTER_QUERY_KEY));
    const filters = canonicalNewLead ? presentNewLeadSavedFilters(rawFilters) : rawFilters;
    const urlHidden = parseSavedStringList(url.searchParams.get("mwHidden") ?? undefined);
    const urlOrder = parseSavedStringList(url.searchParams.get("mwOrder") ?? undefined);
    return {
      kind: activeKind === "cal" ? "calendar" : activeKind === "flat" ? "table" : "board",
      filters,
      groupBy: canonicalNewLead && url.searchParams.get("group")
        ? newLeadPresentationKey(url.searchParams.get("group")!)
        : url.searchParams.get("group") ?? "",
      layout: displayLayout,
      hiddenColumns: url.searchParams.has("mwHidden")
        ? canonicalNewLead ? presentNewLeadColumnKeys(urlHidden) ?? [] : urlHidden
        : activeSaved?.config.hiddenColumns ?? [],
      columnOrder: url.searchParams.has("mwOrder")
        ? canonicalNewLead ? presentNewLeadColumnKeys(urlOrder) ?? [] : urlOrder
        : activeSaved?.config.columnOrder ?? Object.values(displayLayout).flat(),
      calendarFieldKey: url.searchParams.get("calendarField") ?? activeSaved?.config.calendarFieldKey ?? displayColumns.find((column) => column.type === "date")?.key ?? null,
      sorts: filters.sorts ?? activeSaved?.config.sorts ?? (filters.sortKey ? [{ columnKey: filters.sortKey, direction: filters.sortDir }] : []),
      textMode: url.searchParams.has("mwText") ? (url.searchParams.get("mwText") === "wrap" ? "wrap" : "single") : activeSaved?.config.textMode ?? "single",
      focusColumnKey: url.searchParams.has("mwFocus")
        ? canonicalNewLead && url.searchParams.get("mwFocus")
          ? newLeadPresentationKey(url.searchParams.get("mwFocus")!)
          : url.searchParams.get("mwFocus")
        : activeSaved?.config.focusColumnKey ?? null,
    };
  }, [activeKind, activeSaved, canonicalNewLead, displayColumns, displayLayout]);

  useEffect(() => {
    const onSave = (event: Event) => setPending(currentConfig((event as SaveEvent).detail?.filters));
    window.addEventListener("moawork:save-board-view", onSave);
    return () => window.removeEventListener("moawork:save-board-view", onSave);
  }, [currentConfig]);

  const selectSystem = () => {
    window.location.assign(systemViewUrl("flat", window.location.href));
  };
  const selectSaved = async (saved: SavedBoardView) => {
    await request(`/api/tab-views/${saved.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ selected: true }) });
    window.location.assign(savedViewUrl(
      canonicalNewLead ? { ...saved, config: durableNewLeadSavedViewConfig(saved.config) } : saved,
      window.location.href,
    ));
  };
  const changeCalendarField = async (key: string) => {
    if (!activeSaved) return;
    const next: SavedBoardViewConfig = { ...activeSaved.config, calendarFieldKey: key };
    const durable = canonicalNewLead ? durableNewLeadSavedViewConfig(next) : next;
    await request(`/api/tab-views/${activeSaved.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: durable }) });
    setViews((currentViews) => currentViews.map((view) => view.id === activeSaved.id ? { ...view, config: durable } : view));
  };
  const create = async (input: NewTabViewInput) => {
    if (!pending) return;
    const nextConfig: SavedBoardViewConfig = { ...pending, kind: input.kind === "cal" ? "calendar" : input.kind === "flat" ? "table" : "board", calendarFieldKey: input.calendarFieldKey ?? null };
    const durable = canonicalNewLead ? durableNewLeadSavedViewConfig(nextConfig) : nextConfig;
    const created = await request<SavedBoardView>("/api/tab-views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      boardId, name: input.name, visibility: input.visibility,
      personScope: input.personScope, personScopeUserId: input.personScopeUserId ?? null,
      config: durable,
    }) });
    setPending(null);
    window.location.assign(savedViewUrl(
      canonicalNewLead ? { ...created, config: durableNewLeadSavedViewConfig(created.config) } : created,
      window.location.href,
    ));
  };
  const rename = async (name: string) => {
    if (!activeSaved) return;
    await request(`/api/tab-views/${activeSaved.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    setViews((currentViews) => currentViews.map((view) => view.id === activeSaved.id ? { ...view, name } : view));
  };
  const remove = async () => {
    if (!activeSaved) return;
    const result = await request<{ deleted: true; fallback: SavedBoardView | null }>(`/api/tab-views/${activeSaved.id}`, { method: "DELETE" });
    window.location.assign(result.fallback ? savedViewUrl(result.fallback, window.location.href) : systemViewUrl("flat", window.location.href));
  };

  const config = activeSaved?.config ?? currentConfig();
  const personColumnKey = displayColumns.find((column) => column.type === "person")?.key ?? null;
  const personScopedRows = useMemo(
    () => applySavedPersonScope(rows, activeSaved, currentUserId, personColumnKey, teamMemberIds),
    [rows, activeSaved, currentUserId, personColumnKey, teamMemberIds],
  );
  const filterProjection = canonicalNewLead ? NEW_LEAD_SAVED_FILTER_PROJECTION : undefined;
  const filteredRows = useMemo(
    () => applyFilters(personScopedRows, displayColumns, config.filters, filterProjection),
    [personScopedRows, displayColumns, config.filters, filterProjection],
  );
  const orderedColumns = useMemo(() => {
    const hidden = new Set(config.hiddenColumns);
    const selected = config.filters.visibleColumnKeys === null || config.filters.visibleColumnKeys === undefined
      ? null
      : new Set(config.filters.visibleColumnKeys);
    const rank = new Map(config.columnOrder.map((key, index) => [key, index]));
    return displayColumns
      .filter((column) => !hidden.has(column.key) && (selected === null || selected.has(column.key)))
      .sort((a, b) => (rank.get(a.key) ?? 1e6) - (rank.get(b.key) ?? 1e6));
  }, [displayColumns, config.filters.visibleColumnKeys, config.hiddenColumns, config.columnOrder]);
  const tableColumns: TableColumn[] = [{ key: "__title", label: "아이템" }, ...orderedColumns.map((column) => ({ key: column.key, label: column.label }))];
  const dateColumn = displayColumns.find((column) => column.key === config.calendarFieldKey) ?? displayColumns.find((column) => column.type === "date");

  return (
    <section aria-label="저장된 뷰" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ViewTabs views={displayViews} activeId={activeSaved?.id ?? null} onSelectMain={selectSystem} onSelect={(view) => void selectSaved(view)} onRequestCreate={() => setPending(currentConfig())} />
        <ViewPicker view={activeSaved} editable={activeSaved?.canEdit ?? activeSaved?.ownerId === currentUserId} onRename={(name) => void rename(name)} onDelete={() => void remove()} />
        {error ? <span role="alert" className="text-xs text-mw-error">{error}</span> : null}
      </div>
      {pending ? <SaveViewDialog orgId={orgId} boardKey={boardId} ownerId={currentUserId} kind={kindOf(pending)} filters={pending.filters.byColumn} sort={pending.sorts} calendarFieldKey={pending.calendarFieldKey} dateColumns={displayColumns.filter((column) => column.type === "date" || column.type === "datetime").map((column) => ({ key: column.key, label: column.label }))} onSubmit={(input) => void create(input)} onCancel={() => setPending(null)} /> : null}
      {renderMode === "flat" ? <TableView columns={tableColumns} rows={filteredRows} textMode={config.textMode} focusColumnKey={config.focusColumnKey} rowKey={(row) => row.id} renderCell={(row, column) => {
        if (column.key === "__title") return row.title;
        const definition = displayColumns.find((candidate) => candidate.key === column.key);
        return definition ? <BoardCell boardId={boardId} row={row} column={definition} readOnly={!canEditItems} canonicalNewLead={canonicalNewLead} members={memberOptions} /> : "";
      }} /> : null}
      {renderMode === "calendar" ? <>
        <label className="flex items-center gap-2 text-sm text-mw-body">날짜 컬럼
          <select value={dateColumn?.key ?? ""} disabled={!activeSaved} onChange={(event) => void changeCalendarField(event.target.value)} className="rounded border border-mw-line bg-mw-card px-2 py-1">
            {displayColumns.filter((column) => column.type === "date" || column.type === "datetime").map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
        </label>
        {!dateColumn ? <p role="status" className="text-sm text-mw-sub">달력에 표시할 날짜 컬럼이 없습니다.</p> : null}
        <CalendarView rows={filteredRows} rowKey={(row) => row.id} dateOf={(row) => dateColumn && typeof row.values[dateColumn.key] === "string" ? row.values[dateColumn.key] as string : null} renderItem={(row) => <span className="text-xs">{row.title}</span>} year={now.getFullYear()} month={now.getMonth() + 1} />
      </> : null}
    </section>
  );
}
