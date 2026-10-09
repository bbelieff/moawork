"use client";
import { ParentItemLabel } from "@/components/board/ParentItemLabel";

/**
 * 목록(묶지 않은 표)·캘린더 보기 — #845 6단계부터 표·칸반과 같은 보기 줄(BoardViewBar)을 쓴다.
 * 보기 조건(찾기·필터·담당·정렬·보이는 칸)은 화면이 들고 주소(mwFilters)에 남긴다.
 * 저장된 뷰는 «기준» 이다 — 지금 조건과 다르면 보기 줄이 «바뀜» 을 알린다.
 */

import { startTransition,useEffect, useMemo, useRef,useState } from "react";
import {
  activeFilterCount,
  applyFilters,
  assigneeOptions,
  BOARD_FILTER_QUERY_KEY,
  EMPTY_FILTERS,
  encodeBoardFilters,
  type BoardFilterState,
} from "@/components/board/filters";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";
import {
  applySavedPersonScope,
  durableNewLeadSavedViewConfig,
  NEW_LEAD_SAVED_FILTER_PROJECTION,
  parseSavedStringList,
  presentNewLeadSavedFilters,
  presentNewLeadSavedViewConfig,
} from "@/lib/view/board-saved";
import { CalendarView } from "./CalendarView";
import { TableView, type TableColumn } from "./TableView";
import { SavedTableSelection } from "./SavedTableSelection";
import { useSavedViews } from "./use-saved-views";
import { BoardViewBar } from "@/components/board/BoardViewBar";
import { BoardCell } from "@/components/board/GroupTable";
import {
  durableNewLeadColumnKeys,
  isNewLeadPresentationOnlyStructure,
  newLeadPresentationKey,
  presentNewLeadColumnKeys,
  presentNewLeadColumns,
} from "@/lib/default-tabs/new-lead";
import { BoardInlineTitleEditor } from "@/components/board/BoardInlineTitleEditor";
import { columnPlainName } from "@/components/board/column-menu-model";
import { GroupNameEditor } from "@/components/board/GroupNameEditor";
import { renameColumnTitleAction } from "@/app/(app)/boards/title-actions";
import { addBoardLabelOptionAction } from "@/app/(app)/boards/label-option-actions";
import { moveRowAction,reorderGroupsAction } from "@/app/(app)/boards/actions";
import type { BoardGroup } from "@/lib/boards/types";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";
import { workflowKindForSource } from "@/lib/workflow/progress";

const NO_IDS: readonly string[] = [];
const NO_COLUMNS: readonly BoardColumn[] = [];
const NO_ROWS: readonly ItemWithValues[] = [];
const NO_MEMBERS: readonly { id: string; label: string }[] = [];
const NO_GROUPS: readonly BoardGroup[] = [];

export function SavedViewsController({
  boardId, currentUserId, teamMemberIds = NO_IDS, columns = NO_COLUMNS, rows = NO_ROWS, renderMode = "flat", canEditItems = false,
  canonicalNewLead = false, memberOptions = NO_MEMBERS,
  groups = NO_GROUPS, rowOrderVersion = 0, canMoveRows = false, canManageColumns = false,
  canManageSections = false, isSystem = false, canBulkEditItems = false, canDeleteItems = false, canExportItems = false, boardSource = null,
  initialFilters = EMPTY_FILTERS, initialSearch = "", savedViewId = null, loadSavedViews = false,
}: {
  boardId: string; orgId?: string; currentUserId: string;
  teamMemberIds?: readonly string[];
  columns?: readonly BoardColumn[]; rows?: readonly ItemWithValues[];
  renderMode?: "flat" | "calendar";
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
  /** 주소의 mwFilters(서버에서 읽은 것) — 첫 화면부터 같은 조건으로 그린다. */
  initialFilters?: BoardFilterState;
  /** 주소의 나머지(mwHidden·mwOrder·mwText·mwFocus·calendarField) — 서버가 넘긴 그대로 읽는다. */
  initialSearch?: string;
  /** 주소의 savedView — 서버가 읽을 수 있다고 확인한 것만. */
  savedViewId?: string | null;
  loadSavedViews?: boolean;
}) {
  const saved = useSavedViews(boardId, loadSavedViews);
  const [error, setError] = useState<string | null>(null);
  const rowMovePendingRef=useRef(false);
  const rowMoveIntentRef=useRef<{key:string;requestId:string;expectedVersion:number}|null>(null);
  const [rowMovePending,setRowMovePending]=useState(false);
  const [knownRowOrderVersion,setKnownRowOrderVersion]=useState(rowOrderVersion);
  const effectiveRowOrderVersion=Math.max(knownRowOrderVersion,rowOrderVersion);
  const [now] = useState(() => new Date());

  const displayColumns = useMemo(
    () => canonicalNewLead ? presentNewLeadColumns(columns) : [...columns],
    [canonicalNewLead, columns],
  );
  const params = useMemo(() => new URLSearchParams(initialSearch), [initialSearch]);
  const presentKey = (key: string | null) => key && canonicalNewLead ? newLeadPresentationKey(key) : key;

  /* 보기 조건 — 화면 key. 바뀔 때마다 주소에 남긴다(새로고침해도 그대로). */
  const [filters, setFilters] = useState<BoardFilterState>(() =>
    canonicalNewLead ? presentNewLeadSavedFilters(initialFilters) : initialFilters);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeFilterCount(filters) === 0) url.searchParams.delete(BOARD_FILTER_QUERY_KEY);
    else url.searchParams.set(BOARD_FILTER_QUERY_KEY, encodeBoardFilters(filters));
    window.history.replaceState(null, "", url); // null — Next 가 이 주소를 라우터 상태로 받는다(BoardWorkspace.replaceBoardUrl 참고)
  }, [filters]);

  const activeRaw = savedViewId ? saved.views.find((view) => view.id === savedViewId) ?? null : null;
  const activeSaved = useMemo(
    () => activeRaw && canonicalNewLead ? { ...activeRaw, config: presentNewLeadSavedViewConfig(activeRaw.config) } : activeRaw,
    [activeRaw, canonicalNewLead],
  );

  /* 목록 칸 순서·캘린더 날짜 칸 — 보기 조건이 아니다(바뀜으로 세지 않는다). 주소에 남기고, 고칠 수 있는 뷰면 바로 저장한다. */
  const [columnOrder, setColumnOrder] = useState<readonly string[]>(() => {
    const order = parseSavedStringList(params.get("mwOrder") ?? undefined);
    return canonicalNewLead ? presentNewLeadColumnKeys(order) ?? [] : order;
  });
  const hiddenColumns = useMemo(() => {
    const hidden = parseSavedStringList(params.get("mwHidden") ?? undefined);
    return canonicalNewLead ? presentNewLeadColumnKeys(hidden) ?? [] : hidden;
  }, [canonicalNewLead, params]);
  const textMode: "single" | "wrap" = params.get("mwText") === "wrap" ? "wrap" : "single";
  const focusColumnKey = presentKey(params.get("mwFocus"));
  const [pickedCalendarFieldKey, setCalendarFieldKey] = useState<string | null>(() => presentKey(params.get("calendarField")));
  // 주소에 날짜 칸이 없으면 지금 뷰에 저장된 칸 — 계약일로 저장한 캘린더 뷰가 첫 날짜 칸으로 열리지 않게.
  const calendarFieldKey = pickedCalendarFieldKey ?? activeSaved?.config.calendarFieldKey ?? null;

  const persistToActive = async (patch: { columnOrder?: readonly string[]; calendarFieldKey?: string | null }) => {
    if (!activeRaw || !activeSaved?.canEdit) return;
    const next = { ...activeSaved.config, ...patch };
    try {
      await saved.overwrite(activeRaw, canonicalNewLead ? durableNewLeadSavedViewConfig(next) : next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했어요");
    }
  };
  const replaceUrlParam = (key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState(null, "", url); // null — Next 가 이 주소를 라우터 상태로 받는다(BoardWorkspace.replaceBoardUrl 참고)
  };
  const changeCalendarField = async (key: string) => {
    setCalendarFieldKey(key);
    replaceUrlParam("calendarField", canonicalNewLead ? durableNewLeadColumnKeys([key])[0] ?? key : key);
    await persistToActive({ calendarFieldKey: key });
  };

  const personColumnKey = displayColumns.find((column) => column.type === "person")?.key ?? null;
  // 사람 범위는 서버가 이 화면을 그릴 때 읽은 뷰의 것으로 건다(teamMemberIds 도 그 범위로 계산됐다).
  // 「이 뷰에 저장」 이 범위를 바꿔도(담당 · 나 → 보는 사람 기준) 다시 읽기 전까지 행이 사라지지 않게.
  const [scopeView, setScopeView] = useState<typeof activeSaved>(null);
  if (activeSaved && scopeView?.id !== activeSaved.id) setScopeView(activeSaved);
  const personScopedRows = useMemo(
    () => applySavedPersonScope(rows, scopeView, currentUserId, personColumnKey, teamMemberIds, canonicalNewLead),
    [rows, scopeView, currentUserId, personColumnKey, teamMemberIds, canonicalNewLead],
  );
  const filterProjection = canonicalNewLead ? NEW_LEAD_SAVED_FILTER_PROJECTION : undefined;
  // 사람 id → 이름. 찾기와 사람 칸 「이름순」 이 계정 id 가 아니라 이름으로 된다.
  const memberLabels = useMemo(
    () => Object.fromEntries(memberOptions.map((member) => [member.id, member.label])),
    [memberOptions],
  );
  const filteredRows = useMemo(
    () => applyFilters(personScopedRows, displayColumns, filters, filterProjection, memberLabels),
    [personScopedRows, displayColumns, filters, filterProjection, memberLabels],
  );
  const orderedColumns = useMemo(() => {
    const hidden = new Set(hiddenColumns);
    const selected = filters.visibleColumnKeys === null || filters.visibleColumnKeys === undefined
      ? null
      : new Set(filters.visibleColumnKeys);
    const rank = new Map(columnOrder.map((key, index) => [key, index]));
    return displayColumns
      .filter((column) => !hidden.has(column.key) && (selected === null || selected.has(column.key)))
      .sort((a, b) => (rank.get(a.key) ?? 1e6) - (rank.get(b.key) ?? 1e6));
  }, [displayColumns, filters.visibleColumnKeys, hiddenColumns, columnOrder]);
  const tableColumns: TableColumn[] = [{ key: "__title", label: "아이템" }, ...orderedColumns.map((column) => ({ key: column.key, label: column.label }))];
  const dateColumns = displayColumns.filter((column) => column.type === "date" || column.type === "datetime");
  const dateColumn = dateColumns.find((column) => column.key === calendarFieldKey) ?? dateColumns.find((column) => column.type === "date") ?? dateColumns[0];
  const sortActive=(filters.sorts?.length??0)>0||Boolean(filters.sortKey);
  const people = useMemo(() => assigneeOptions(rows, memberLabels), [memberLabels, rows]);
  const config = { textMode, focusColumnKey };
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
  /* #845 6단계 — 저장된 뷰가 없어도 옮긴 칸 순서를 잃지 않게 주소에 JSON 으로 남긴다(예전에는 쉼표로 남겨 다시 못 읽었다). */
  const moveFlatColumn=async(key:string,delta:-1|1)=>{
    const keys=orderedColumns.map((column)=>column.key);const from=keys.indexOf(key);
    const to=Math.max(0,Math.min(keys.length-1,from+delta));if(from<0||from===to)return;
    const [moved]=keys.splice(from,1);keys.splice(to,0,moved);
    setColumnOrder(keys);
    replaceUrlParam("mwOrder",JSON.stringify(canonicalNewLead?durableNewLeadColumnKeys(keys):keys));
    await persistToActive({columnOrder:keys});
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
      <BoardViewBar
        boardId={boardId}
        currentUserId={currentUserId}
        mode={renderMode}
        filters={filters}
        onChange={setFilters}
        columns={displayColumns}
        rows={personScopedRows}
        people={people}
        matched={filteredRows.length}
        total={personScopedRows.length}
        canonicalNewLead={canonicalNewLead}
        activeViewId={savedViewId}
        calendarAvailable={dateColumns.length > 0}
        defaultCalendarFieldKey={dateColumn?.key ?? null}
        savedViews={saved}
      />
      {error ? <span role={noticeRole(false)} aria-live={noticeLive(false)} className="text-xs text-mw-error">{error}</span> : null}
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
        return <span className="flex items-center gap-1">{canManageColumns&&!isSystem&&!presentationOnly?<BoardInlineTitleEditor name={columnPlainName(definition.label)} label="컬럼 이름" onSave={(value)=>renameColumnTitleAction(boardId,definition.id,value)}/>:columnPlainName(definition.label)}{canManageColumns&&!isSystem&&!presentationOnly?<span className="sr-only focus-within:not-sr-only"><button type="button" onClick={()=>void moveFlatColumn(column.key,-1)} aria-label={`${definition.label} 왼쪽으로 이동`}>왼쪽으로 이동</button><button type="button" onClick={()=>void moveFlatColumn(column.key,1)} aria-label={`${definition.label} 오른쪽으로 이동`}>오른쪽으로 이동</button></span>:null}</span>;
      }} renderCell={(row, column) => {
        if (column.key === "__selection") return cell(row);
        if (column.key === "__title") return <span className="flex min-w-0 flex-col gap-1"><span>{row.title}{rowMoveControls(row)}</span><ParentItemLabel parentId={row.parent_item_id} title={filteredRows.find((candidate) => candidate.id === row.parent_item_id)?.title} /></span>;
        const definition = displayColumns.find((candidate) => candidate.key === column.key);
        return definition ? <BoardCell boardId={boardId} row={row} column={definition} readOnly={!canEditItems} canonicalNewLead={canonicalNewLead} canonicalOwner={workflowKindForSource(boardSource ?? null) !== null} members={memberOptions} canCreateColumnOptions={canManageColumns && !isSystem} addLabelOptionAction={addBoardLabelOptionAction} /> : "";
      }} />}
      </SavedTableSelection> : null}
      {renderMode === "calendar" ? <>
        <label className="flex items-center gap-2 text-sm text-mw-body">날짜 칸
          <select value={dateColumn?.key ?? ""} onChange={(event) => void changeCalendarField(event.target.value)} className="rounded border border-mw-line bg-mw-card px-2 py-1">
            {dateColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
        </label>
        {!dateColumn ? <p role="status" className="text-sm text-mw-sub">날짜 칸이 없어요</p> : null}
        <CalendarView rows={filteredRows} rowKey={(row) => row.id} dateOf={(row) => dateColumn && typeof row.values[dateColumn.key] === "string" ? row.values[dateColumn.key] as string : null} renderItem={(row) => <span className="text-xs">{row.title}</span>} year={now.getFullYear()} month={now.getMonth() + 1} />
      </> : null}
    </section>
  );
}
