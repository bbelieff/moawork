"use client";

import { startTransition,useCallback, useEffect, useMemo, useRef,useState } from "react";
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
import { SavedTableSelection } from "./SavedTableSelection";
import { BoardCell } from "@/components/board/GroupTable";
import { isNewLeadPresentationOnlyStructure,newLeadPresentationKey, presentNewLeadColumnKeys, presentNewLeadColumns } from "@/lib/default-tabs/new-lead";
import { BoardInlineTitleEditor } from "@/components/board/BoardInlineTitleEditor";
import { GroupNameEditor } from "@/components/board/GroupNameEditor";
import { renameColumnTitleAction } from "@/app/(app)/boards/title-actions";
import { moveRowAction,reorderGroupsAction } from "@/app/(app)/boards/actions";
import type { BoardGroup } from "@/lib/boards/types";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";

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
  groups = [], rowOrderVersion = 0, canMoveRows = false, canManageColumns = false,
  canManageSections = false, isSystem = false, canBulkEditItems = false, canDeleteItems = false, canExportItems = false, boardSource = null,
}: {
  boardId: string; orgId: string; currentUserId: string;
  teamMemberIds?: readonly string[];
  layout?: Record<string, readonly string[]>; columns?: readonly BoardColumn[]; rows?: readonly ItemWithValues[];
  renderMode?: "controls" | "flat" | "calendar";
  canEditItems?: boolean;
  canonicalNewLead?: boolean;
  memberOptions?: readonly { id: string; label: string }[];
  groups?: readonly BoardGroup[];
  rowOrderVersion?: number;
  canMoveRows?: boolean;
  canManageColumns?: boolean;
  canManageSections?: boolean;
  isSystem?: boolean;
  canBulkEditItems?: boolean;
  canDeleteItems?: boolean;
  canExportItems?: boolean;
  boardSource?: string | null;
}) {
  const [views, setViews] = useState<SavedBoardView[]>([]);
  const [pending, setPending] = useState<SavedBoardViewConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowMovePendingRef=useRef(false);
  const rowMoveIntentRef=useRef<{key:string;requestId:string;expectedVersion:number}|null>(null);
  const [rowMovePending,setRowMovePending]=useState(false);
  const [knownRowOrderVersion,setKnownRowOrderVersion]=useState(rowOrderVersion);
  const effectiveRowOrderVersion=Math.max(knownRowOrderVersion,rowOrderVersion);
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
  const sortActive=(config.sorts?.length??0)>0||Boolean(config.filters.sortKey);
  const submitFlatRowMove=(form:HTMLFormElement)=>{
    if(rowMovePendingRef.current){setError("이전 이동을 저장하고 있어요.");return;}
    rowMovePendingRef.current=true;setRowMovePending(true);setError(null);
    const fd=new FormData(form);
    if(fd.get("moveKind")==="group"&&String(fd.get("groupId")??"")===String(fd.get("currentGroupId")??"")){
      rowMovePendingRef.current=false;setRowMovePending(false);return;
    }
    const intentKey=JSON.stringify({itemId:fd.get("itemId"),groupId:fd.get("groupId"),beforeItemId:fd.get("beforeItemId")});
    if(rowMoveIntentRef.current?.key!==intentKey)rowMoveIntentRef.current={key:intentKey,requestId:crypto.randomUUID(),expectedVersion:effectiveRowOrderVersion};
    fd.set("expectedVersion",String(rowMoveIntentRef.current.expectedVersion));
    fd.set("requestId",rowMoveIntentRef.current.requestId);fd.set("eventKey",rowMoveIntentRef.current.requestId);
    startTransition(async()=>{
      try{const result=await moveRowAction(fd);if(result.ok){rowMoveIntentRef.current=null;setKnownRowOrderVersion((current)=>Math.max(current,result.version));setError(null);}else{if(result.stale)rowMoveIntentRef.current=null;setError(result.message);}}
      catch{setError("행 이동을 저장하지 못했어요. 현재 순서를 다시 확인해 주세요.");}
      finally{rowMovePendingRef.current=false;setRowMovePending(false);}
    });
  };
  const moveFlatColumn=async(key:string,delta:-1|1)=>{
    const keys=orderedColumns.map((column)=>column.key);const from=keys.indexOf(key);
    const to=Math.max(0,Math.min(keys.length-1,from+delta));if(from<0||from===to)return;
    const [moved]=keys.splice(from,1);keys.splice(to,0,moved);
    if(activeSaved){
      const next={...activeSaved.config,columnOrder:keys};const durable=canonicalNewLead?durableNewLeadSavedViewConfig(next):next;
      await request(`/api/tab-views/${activeSaved.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({config:durable})});
      setViews((current)=>current.map((view)=>view.id===activeSaved.id?{...view,config:durable}:view));
      return;
    }
    const url=new URL(window.location.href);url.searchParams.set("mwOrder",keys.join(","));window.location.assign(url);
  };
  const rowMoveControls=(row:ItemWithValues)=>{
    if(!canMoveRows||isSystem||sortActive)return null;
    const siblings=filteredRows.filter((candidate)=>candidate.group_id===row.group_id);
    const at=siblings.findIndex((candidate)=>candidate.id===row.id);
    const moves:[string,string|null,boolean][]=[
      ["위로 이동",at>0?siblings[at-1].id:null,at<=0],
      ["아래로 이동",at>=0&&at+2<siblings.length?siblings[at+2].id:null,at<0||at>=siblings.length-1],
    ];
    return <span className="sr-only focus-within:not-sr-only">
      {moves.map(([label,before,disabled])=><form key={label} onSubmit={(event)=>{event.preventDefault();submitFlatRowMove(event.currentTarget);}} className="inline">
        <input type="hidden" name="boardId" value={boardId}/><input type="hidden" name="itemId" value={row.id}/>
        <input type="hidden" name="groupId" value={row.group_id??""}/><input type="hidden" name="currentGroupId" value={row.group_id??""}/><input type="hidden" name="beforeItemId" value={before??""}/>
        <input type="hidden" name="expectedVersion" value={effectiveRowOrderVersion}/><button type="submit" disabled={disabled||rowMovePending} aria-label={`${row.title} ${label}`}>{label}</button>
      </form>)}
      {groups.length>1?<form onSubmit={(event)=>{event.preventDefault();submitFlatRowMove(event.currentTarget);}} className="inline">
        <input type="hidden" name="boardId" value={boardId}/><input type="hidden" name="itemId" value={row.id}/><input type="hidden" name="beforeItemId" value=""/><input type="hidden" name="currentGroupId" value={row.group_id??""}/><input type="hidden" name="moveKind" value="group"/>
        <input type="hidden" name="expectedVersion" value={effectiveRowOrderVersion}/><select name="groupId" defaultValue={row.group_id??""} disabled={rowMovePending} aria-label={`${row.title} 이동할 그룹`}>
          {groups.map((group)=><option key={group.id} value={group.id}>{group.name}</option>)}
        </select><button type="submit" disabled={rowMovePending}>그룹으로 이동</button>
      </form>:null}
    </span>;
  };

  return (
    <section aria-label="저장된 뷰" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ViewTabs views={displayViews} activeId={activeSaved?.id ?? null} onSelectMain={selectSystem} onSelect={(view) => void selectSaved(view)} onRequestCreate={() => setPending(currentConfig())} />
        <ViewPicker view={activeSaved} editable={activeSaved?.canEdit ?? activeSaved?.ownerId === currentUserId} onRename={(name) => void rename(name)} onDelete={() => void remove()} />
        {error ? <span role={noticeRole(false)} aria-live={noticeLive(false)} className="text-xs text-mw-error">{error}</span> : null}
      </div>
      {pending ? <SaveViewDialog orgId={orgId} boardKey={boardId} ownerId={currentUserId} kind={kindOf(pending)} filters={pending.filters.byColumn} sort={pending.sorts} calendarFieldKey={pending.calendarFieldKey} dateColumns={displayColumns.filter((column) => column.type === "date" || column.type === "datetime").map((column) => ({ key: column.key, label: column.label }))} onSubmit={(input) => void create(input)} onCancel={() => setPending(null)} /> : null}
      {renderMode==="flat"&&!isSystem&&canManageSections&&groups.length>0?<nav aria-label="그룹 이름과 순서" className="flex flex-wrap gap-2">{groups.map((group,index)=>{
        const next=[...groups].sort((a,b)=>a.sort_order-b.sort_order).map((candidate)=>candidate.id);return <span key={group.id} className="inline-flex items-center rounded border border-mw-line px-2 py-1 text-xs"><GroupNameEditor boardId={boardId} groupId={group.id} name={group.name}/><span className="sr-only focus-within:not-sr-only">{([-1,1] as const).map((delta)=>{const to=Math.max(0,Math.min(next.length-1,index+delta));const ordered=[...next];if(index!==to){const [moved]=ordered.splice(index,1);ordered.splice(to,0,moved);}return <form key={delta} action={reorderGroupsAction} className="inline"><input type="hidden" name="boardId" value={boardId}/><input type="hidden" name="groupIds" value={JSON.stringify(ordered)}/><button type="submit" disabled={index===to} aria-label={`${group.name} ${delta<0?"위":"아래"}로 이동`}>{delta<0?"↑":"↓"}</button></form>;})}</span></span>;})}</nav>:null}
      {renderMode === "flat" ? <SavedTableSelection key={boardId} boardId={boardId} boardSource={boardSource} rows={filteredRows} columns={orderedColumns} physicalColumns={columns}
        members={memberOptions} groups={groups} canEdit={canEditItems && canBulkEditItems && !isSystem}
        canMove={canMoveRows} canDelete={canDeleteItems && canBulkEditItems && !isSystem} canExport={canExportItems}>
        {({ header, cell }) => <TableView columns={[{ key: "__selection", label: header }, ...tableColumns]} rows={filteredRows} textMode={config.textMode} focusColumnKey={config.focusColumnKey} rowKey={(row) => row.id} renderHeader={(column)=>{
        if(column.key==="__title")return column.label;
        const definition=displayColumns.find((candidate)=>candidate.key===column.key);
        if(!definition)return column.label;
        const presentationOnly=canonicalNewLead&&isNewLeadPresentationOnlyStructure(definition);
        return <span className="flex items-center gap-1">{canManageColumns&&!isSystem&&!presentationOnly?<BoardInlineTitleEditor name={definition.label} label="컬럼 이름" onSave={(value)=>renameColumnTitleAction(boardId,definition.id,value)}/>:definition.label}{canManageColumns&&!isSystem&&!presentationOnly?<span className="sr-only focus-within:not-sr-only"><button type="button" onClick={()=>void moveFlatColumn(column.key,-1)} aria-label={`${definition.label} 왼쪽으로 이동`}>왼쪽으로 이동</button><button type="button" onClick={()=>void moveFlatColumn(column.key,1)} aria-label={`${definition.label} 오른쪽으로 이동`}>오른쪽으로 이동</button></span>:null}</span>;
      }} renderCell={(row, column) => {
        if (column.key === "__selection") return cell(row);
        if (column.key === "__title") return <span className="flex items-center gap-1">{row.title}{rowMoveControls(row)}</span>;
        const definition = displayColumns.find((candidate) => candidate.key === column.key);
        return definition ? <BoardCell boardId={boardId} row={row} column={definition} readOnly={!canEditItems} canonicalNewLead={canonicalNewLead} members={memberOptions} /> : "";
      }} />}
      </SavedTableSelection> : null}
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
