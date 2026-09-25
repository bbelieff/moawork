"use client";

/**
 * 보드 화면 셸 — 헤더 1줄 + 도구줄 1줄 + **블록 리스트** (PLAN-002 WO-2).
 *
 * 이 파일이 갖는 상태는 세 가지뿐이다:
 *  ① 필터(클라이언트 전용 — 서버에 저장하지 않는다. 저장 뷰는 WO-3 범위)
 *  ② 지금 끌고 있는 행 id (그룹을 가로질러 놓을 수 있어야 하므로 여기서 든다)
 *  ③ 서버 상태의 **낙관적 겹침**(useOptimistic) — 드롭한 순간 화면이 먼저 움직이고,
 *    서버 액션이 revalidate 하면 서버 값으로 자연스럽게 대체된다.
 *
 * 드래그 인덱스의 함정: 화면에 보이는 행은 필터를 통과한 일부다. 그래서 GroupTable 이
 * 올려주는 인덱스는 **보이는 목록 기준**이고, 여기서 그룹 전체 기준으로 환산한 뒤에야
 * 서버로 보낸다(`toFullIndex`). 이 환산을 빼먹으면 필터가 걸린 상태의 드롭이 엉뚱한
 * 자리에 꽂힌다.
 *
 * 정렬 칩이 켜져 있는 동안에는 행 드래그를 잠근다 — 보이는 순서가 저장된 순서가 아니라서
 * "여기 놓았는데 저기 꽂히는" 거짓말이 되기 때문이다.
 */

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import type { CellFlash } from "@/lib/boards/cellFlash";
import {
  moveRowAction,
  reorderGroupsAction,
  setGroupColumnOrderAction,
} from "@/app/(app)/boards/actions";
import { BoardHeader } from "./BoardHeader";
import { BoardScrollViewport } from "./BoardScrollViewport";
import { BoardToolbar } from "./BoardToolbar";
import { GroupBlock } from "./GroupBlock";
import { GroupNameEditor } from "./GroupNameEditor";
import { claimBoardTransientSurface } from "./BoardAnchoredMenu";
import { GroupTable } from "./GroupTable";
import type { MemberPickerMember } from "./MemberPicker";
import { NewLeadIntakeForm } from "./NewLeadIntakeForm";
import { groupPresetName, isGroupPresetChanged } from "@/lib/presets/group-preset";
import { ContactPipelineAction } from "@/components/crm/ContactPipelineAction";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE, NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import type { CompanyPickerLoadResult } from "@/lib/companies/picker-server";
import { buildCompanyPickerProps } from "@/lib/companies/picker-props";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";
import {
  durableNewLeadColumnKeys,
  NEW_LEAD_DETAIL_ONLY_KEYS,
  newLeadPresentationKey,
  presentNewLeadColumnKeys,
  presentNewLeadColumns,
  presentNewLeadDetailLayout,
} from "@/lib/default-tabs/new-lead";
import { NOTICE_KEYS } from "@/lib/notices/types";
import { buildBlocks } from "./blocks";
import {
  groupKeyOf,
  reorderColumnKeys,
  resolveColumnOrder,
  type GroupColumnOrder,
} from "./layout";
import {
  applyFilters,
  activeFilterCount,
  assigneeOptions,
  BOARD_FILTER_QUERY_KEY,
  decodeBoardFilters,
  encodeBoardFilters,
  EMPTY_FILTERS,
  selectVisibleColumns,
  type BoardFilterState,
} from "./filters";
import { resolveBoardDetailLayout, resolveDetailLayout } from "@/lib/boards/detail-layout";
import type { ItemDetailSnapshot } from "@/app/(app)/boards/item-detail-actions";
import { runColumnCommandAction } from "@/app/(app)/boards/column-command-actions";
import { INITIAL_COLUMN_COMMAND_STATE } from "@/app/(app)/boards/column-command-state";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";
import {
  presentWorkflowProgressColumns,
  withWorkflowProgressValues,
  workflowDetailHiddenKeys,
  workflowKindForSource,
} from "@/lib/workflow/progress";
import {
  NEW_LEAD_SAVED_FILTER_PROJECTION,
  presentNewLeadSavedFilters,
} from "@/lib/view/board-saved";
import {
  BULK_BLOCKED_COLUMN_KEYS,
  BULK_BLOCKED_VALUES,
  bulkRangeIds,
  intersectVisibleSelection,
  pruneSelection,
  selectionScopeKey,
  selectionToCsv,
  toggleGroupSelection,
  toggleSelection,
} from "./bulk-selection";
import {
  BulkActionBar,
  type BulkDialogState,
  type BulkOpKind,
} from "./BulkActionBar";
import { isSourceEditable } from "@/lib/field/source";
import {
  decideBulkIntercept,
  pickBulkStatusColumn,
} from "@/app/(app)/boards/bulk-action-gates";
import { WORKFLOW_PROGRESS_KEY } from "@/lib/workflow/progress";
import { BoardSummaryStrip } from "./BoardSummaryStrip";
import { BoardSummarySettingsPopover } from "./BoardSummarySettingsPopover";
import { formatCell } from "@/lib/boards/cells";
import { parseBoardSummaryConfig, type BoardSummarySettingsRequest } from "@/lib/boards/summary-settings";
import { saveBoardSummarySettingsAction } from "@/app/(app)/boards/[id]/summary-actions";

const NEW_LEAD_LEGACY_FACET_LABELS = { revenue_band: "기존 매출구간" } as const;

interface RowMove {
  itemId: string;
  groupId: string | null;
  /** 그룹 **전체** 기준 삽입 위치. */
  index: number;
}

export function companyFoundedOn(value: unknown): string {
  const text = String(value ?? "").trim();
  if (/^\d{4}$/.test(text)) return `${text}-01-01`;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function companyRevenue(value: unknown): string {
  const text = String(value ?? "").trim().replaceAll(",", "");
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : "";
}

/** 낙관적 행 이동 — 서버의 moveRowAction 과 같은 규칙(그룹 내 재색인)을 화면에서 미리 흉내낸다. */
function rowMoveReducer(rows: ItemWithValues[], move: RowMove): ItemWithValues[] {
  const moving = rows.find((r) => r.id === move.itemId);
  if (!moving) return rows;

  const targetKey = groupKeyOf(move.groupId);
  const rest = rows.filter((r) => r.id !== move.itemId);
  const siblings = rest
    .filter((r) => groupKeyOf(r.group_id) === targetKey)
    .sort((a, b) => a.sort_order - b.sort_order);

  const at = Math.max(0, Math.min(move.index, siblings.length));
  siblings.splice(at, 0, { ...moving, group_id: move.groupId });

  const renumbered = siblings.map((r, i) => ({ ...r, sort_order: i }));
  const others = rest.filter((r) => groupKeyOf(r.group_id) !== targetKey);
  // 순서는 buildBlocks 가 sort_order 로 다시 세우므로 배열 순서는 의미가 없다.
  return [...others, ...renumbered];
}

interface ColumnOrderPatch {
  groupKey: string;
  keys: string[];
}

function columnOrderReducer(
  state: GroupColumnOrder,
  patch: ColumnOrderPatch,
): GroupColumnOrder {
  return { ...state, [patch.groupKey]: patch.keys };
}

export function BoardWorkspace({
  board,
  columns,
  summaryColumns = columns,
  groups,
  rows,
  columnOrder,
  cellFlash,
  assigneeLabels,
  memberDirectory,
  backSlot,
  viewSlot,
  savedViewsSlot,
  settingsSlot,
  onboardingSlot,
  canEditItems = false,
  canDeleteItems = false,
  canBulkEditItems = false,
  canExportItems = false,
  canManageColumns = false,
  canManageSections = false,
  canManageSummaries = false,
  canMoveRows = false,
  savedViewActive = false,
  savedViewId = null,
  currentUserId,
  cellAction,
  itemDetailFixture,
  workflowTransitionSlot,
  contractWorkCompanyPicker = { rows: [], error: null, truncated: false },
  startCompanyWorkAction,
}: {
  board: Board;
  /** 계약업체 실무에서만 채워진다 — 「＋ 업체 추가」 목록. 다른 보드는 빈 배열이다. */
  contractWorkCompanyPicker?: CompanyPickerLoadResult;
  startCompanyWorkAction?: (
    previous: CompanyIntakeActionState,
    formData: FormData,
  ) => Promise<CompanyIntakeActionState>;
  columns: BoardColumn[];
  /** URL/saved-view hidden과 무관한 보드의 전체 active 컬럼. */
  summaryColumns?: BoardColumn[];
  groups: BoardGroup[];
  rows: ItemWithValues[];
  /** 그룹별 컬럼 배치 오버라이드(서버 저장분). */
  columnOrder: GroupColumnOrder;
  cellFlash: CellFlash | null;
  /** 사용자 id → 표시 이름. 담당자 탭·칩에 UUID 가 그대로 나오지 않게 한다. */
  assigneeLabels: Record<string, string>;
  /** 활성 조직 멤버의 사람 선택기 표시 정보. 조직도 공급자가 붙으면 이 경계만 교체한다. */
  memberDirectory?: readonly MemberPickerMember[];
  /** 헤더 1줄 안에 얹을 화면 고유 컨트롤(뒤로가기·뷰 전환) — 줄을 늘리지 않기 위한 슬롯. */
  backSlot?: ReactNode;
  viewSlot?: ReactNode;
  /**
   * 저장된 뷰 줄 — 목업 순서상 «보드 이름 아래 · 필터 위» 다 (BBE-214).
   * 근거: UI목업_워크스페이스_최종_v6.html 의 head() —
   *   :1810 `.hrow > .h1` 보드 이름 → :1821 `.vrow` 보기 → :1841 filterbar 필터.
   * 뷰는 «보드에 속한 것» 이라 소속처보다 위에 두면 위계가 뒤집혀 보인다.
   */
  savedViewsSlot?: ReactNode;
  /** 보드 상단에서 즉시 발견되는 단일 설정 진입점. */
  settingsSlot?: ReactNode;
  /** 서버가 판정한 신규리드 1회 온보딩. 권한 판정에는 사용하지 않는다. */
  onboardingSlot?: ReactNode;
  canEditItems?: boolean;
  canDeleteItems?: boolean;
  canBulkEditItems?: boolean;
  canExportItems?: boolean;
  canManageColumns?: boolean;
  canManageSections?: boolean;
  canManageSummaries?: boolean;
  /** Whole-group reindex is available only to owner/admin/all-scope sessions. */
  canMoveRows?: boolean;
  savedViewActive?: boolean;
  savedViewId?: string | null;
  /** BBE-239 — 공지사항에서 작성자 본인 삭제 예외를 판정하는 데 쓴다. */
  currentUserId?: string;
  /** 시각 fixture가 제품 UI를 우회하지 않고 저장소 경계만 대체할 때 사용한다. */
  cellAction?: (formData: FormData) => Promise<void>;
  /** `/login/visual-fixture`의 마스킹 상세 기록. 제품 경로에서는 넘기지 않는다. */
  itemDetailFixture?: ItemDetailSnapshot;
  /** 시각 fixture가 실제 진행현황 확인창을 유지한 채 이동 저장소만 대체한다. */
  workflowTransitionSlot?: ReactNode;
}) {
  // BBE-239 — 공지사항 한정 「작성자는 자기 글 삭제 가능」 예외. 다른 보드는 undefined 라
  // GroupTable 의 조건에서 항상 꺼진다.
  const authorColumnKey = board.source === NOTICE_TAB_SOURCE ? NOTICE_KEYS.author : undefined;
  const [filters, setFilters] = useState<BoardFilterState>(EMPTY_FILTERS);
  const [summaryConfig, setSummaryConfig] = useState(() => parseBoardSummaryConfig(board.summary_config_jsonb));
  const [filterUrlReady, setFilterUrlReady] = useState(false);
  const [savedPresentation, setSavedPresentation] = useState<{ textMode: "single" | "wrap"; focusColumnKey: string | null }>({ textMode: "single", focusColumnKey: null });
  const [archivedColumnIds, setArchivedColumnIds] = useState<Set<string>>(() => new Set());
  const [restoring, setRestoring] = useState(false);
  const [restoringColumnId, setRestoringColumnId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const workflowProgressKind = workflowKindForSource(board.source);
  const canonicalNewLead = board.source === NEW_LEAD_TAB_SOURCE;
  const filterProjection = canonicalNewLead ? NEW_LEAD_SAVED_FILTER_PROJECTION : undefined;
  const displayFilters = useMemo(
    () => canonicalNewLead
      ? presentNewLeadSavedFilters(filters)
      : filters,
    [canonicalNewLead, filters],
  );
  const physicalActiveColumns = useMemo(
    () => columns.filter((column) => !archivedColumnIds.has(column.id)),
    [archivedColumnIds, columns],
  );
  const activeColumns = useMemo(() => {
    const visible = physicalActiveColumns;
    const ordered = canonicalNewLead
      ? presentNewLeadColumns(visible)
      : visible;
    return workflowProgressKind
      ? presentWorkflowProgressColumns(workflowProgressKind, ordered)
      : ordered;
  }, [canonicalNewLead, physicalActiveColumns, workflowProgressKind]);
  const activeSummaryColumns = useMemo(() => {
    // Durable summary targets always use physical board column keys. Table/view
    // presentation may collapse those columns (for example the credit score
    // composite), but that synthetic key must never enter shared config.
    return summaryColumns.filter((column) => !archivedColumnIds.has(column.id));
  }, [archivedColumnIds, summaryColumns]);
  const tableColumns = useMemo(
    () => board.source === NEW_LEAD_TAB_SOURCE
      ? activeColumns.filter((column) => !NEW_LEAD_DETAIL_ONLY_KEYS.has(column.key))
      : activeColumns,
    [activeColumns, board.source],
  );
  const detailColumns = useMemo(
    () => {
      const hidden = new Set(workflowProgressKind ? workflowDetailHiddenKeys(workflowProgressKind) : []);
      return activeColumns.filter((column) => !hidden.has(column.key));
    },
    [activeColumns, workflowProgressKind],
  );
  const physicalDetailColumns = useMemo(
    () => {
      const hidden = new Set(workflowProgressKind ? workflowDetailHiddenKeys(workflowProgressKind) : []);
      return physicalActiveColumns.filter((column) => !hidden.has(column.key));
    },
    [physicalActiveColumns, workflowProgressKind],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      setFilters(decodeBoardFilters(params.get(BOARD_FILTER_QUERY_KEY)));
      const rawFocusColumnKey = params.get("mwFocus");
      setSavedPresentation({
        textMode: params.get("mwText") === "wrap" ? "wrap" : "single",
        focusColumnKey: canonicalNewLead && rawFocusColumnKey
          ? newLeadPresentationKey(rawFocusColumnKey)
          : rawFocusColumnKey,
      });
      setFilterUrlReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canonicalNewLead]);

  useEffect(() => {
    if (!filterUrlReady) return;
    const url = new URL(window.location.href);
    if (activeFilterCount(filters) === 0) url.searchParams.delete(BOARD_FILTER_QUERY_KEY);
    else url.searchParams.set(BOARD_FILTER_QUERY_KEY, encodeBoardFilters(filters));
    window.history.replaceState(window.history.state, "", url);
  }, [filterUrlReady, filters]);
  /*
   * 끌고 있는 행: ref 가 정본(드롭 판정), state 는 표시(반투명·드롭 안내문)용.
   * dragstart 와 drop 사이에 리렌더가 끼지 않아도 드롭이 성립해야 한다.
   */
  const dragRowRef = useRef<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const rowOrderVersionRef = useRef(board.row_order_version ?? 0);
  const latestRowOrderVersionPropRef = useRef(board.row_order_version ?? 0);
  const rowMoveInFlightRef = useRef(false);
  const rowMoveIntentRef=useRef<{key:string;requestId:string;expectedVersion:number}|null>(null);
  const [rowMovePending,setRowMovePending]=useState(false);
  const [moveNotice,setMoveNotice]=useState<string|null>(null);

  useEffect(()=>{
    const next=board.row_order_version??0;
    latestRowOrderVersionPropRef.current=next;
    if(!rowMoveInFlightRef.current)rowOrderVersionRef.current=next;
  },[board.row_order_version]);

  const [optimisticRows, moveRowOptimistic] = useOptimistic(rows, rowMoveReducer);
  const displayRows = useMemo(
    () => workflowProgressKind
      ? withWorkflowProgressValues(workflowProgressKind, optimisticRows)
      : optimisticRows,
    [optimisticRows, workflowProgressKind],
  );
  const [optimisticOrder, setOrderOptimistic] = useOptimistic(columnOrder, columnOrderReducer);

  /*
   * 일괄 선택 — 이 BoardWorkspace 인스턴스(현재 탭·보기)에만 산다.
   * 일괄 대상은 «선택 ∩ 현재 보이는 행» (bulk-selection.intersectVisibleSelection).
   * 보드·저장 보기 전환 시 비운다. 필터로 숨겨진 행은 절대 수정하지 않는다.
   *
   * effect로 setState하지 않는다 — 보드·보기 식별자를 렌더 중에 비교해
   * 같은 렌더에서 상태를 맞춘다 (react-hooks/set-state-in-effect 회피가 아니라
   * 캐스케이드 렌더를 없애는 정본 패턴).
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialog, setBulkDialog] = useState<BulkDialogState | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [selectionScope, setSelectionScope] = useState(() => selectionScopeKey(board.id, savedViewId ?? savedViewActive));
  const currentSelectionScope = selectionScopeKey(board.id, savedViewId ?? savedViewActive);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  if (selectionScope !== currentSelectionScope) {
    setSelectionScope(currentSelectionScope);
    setSelectedIds(new Set());
    setBulkDialog(null);
    setBulkNotice(null);
  }
  // Shift-범위 기준점 — 보이는 순서에서의 마지막 토글 위치.
  const lastToggledRef = useRef<string | null>(null);

  const readOnly = board.is_system || !canEditItems;
  const sortActive = filters.sortKey !== "" || (filters.sorts?.length ?? 0) > 0;
  const rowDragEnabled = !readOnly && canMoveRows && !sortActive && !rowMovePending;

  const [orderedGroups, setOrderedGroups] = useOptimistic(
    [...groups].sort((a, b) => a.sort_order - b.sort_order),
    (_current, next: BoardGroup[]) => next,
  );
  const draggedGroupRef = useRef<string | null>(null);
  const persistGroupOrder = useCallback((next: BoardGroup[]) => {
    startTransition(async () => {
      setOrderedGroups(next);
      const fd = new FormData();
      fd.set("boardId", board.id);
      fd.set("groupIds", JSON.stringify(next.map((group) => group.id)));
      await reorderGroupsAction(fd);
    });
  }, [board.id, setOrderedGroups]);
  const moveGroup = useCallback((groupId: string, delta: number) => {
    const from = orderedGroups.findIndex((group) => group.id === groupId);
    const to = Math.max(0, Math.min(orderedGroups.length - 1, from + delta));
    if (from < 0 || from === to) return;
    const next = [...orderedGroups];
    const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    persistGroupOrder(next);
  }, [orderedGroups, persistGroupOrder]);
  const dropGroup = useCallback((targetId: string) => {
    const draggedId = draggedGroupRef.current; draggedGroupRef.current = null;
    if (!draggedId || draggedId === targetId) return;
    const next = [...orderedGroups];
    const from = next.findIndex((group) => group.id === draggedId);
    const to = next.findIndex((group) => group.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    persistGroupOrder(next);
  }, [orderedGroups, persistGroupOrder]);

  const blocks = useMemo(() => buildBlocks(orderedGroups, displayRows), [orderedGroups, displayRows]);

  // 사라진 행 id는 렌더 중에 털어낸다 — effect로 미루면 삭제된 id가 복구·필터 전환 때
  // 다시 보이는 «예상 밖 재등장»이 된다. 필터로 숨겨진 행은 여기서 지우지 않는다
  // (숨김은 intersectVisibleSelection이 대상에서만 제외하고 선택 자체는 유지한다).
  const allRowIds = useMemo(() => new Set(displayRows.map((row) => row.id)), [displayRows]);
  if (selectedIds.size > 0) {
    let hasStale = false;
    for (const id of selectedIds) {
      if (!allRowIds.has(id)) { hasStale = true; break; }
    }
    if (hasStale) {
      setSelectedIds(pruneSelection(selectedIds, allRowIds));
    }
  }

  /**
   * 그룹의 최종 표시 컬럼 — 본문 map 과 같은 계산 (표시 전용).
   * 검색(q)은 표시와 분리한다 — UI 열을 숨겼다고 권한 밖이 되는 것이 아니다.
   */
  const columnsForBlock = useCallback((blockKey: string) => {
    const storedOrder = canonicalNewLead
      ? presentNewLeadColumnKeys(optimisticOrder[blockKey])
      : optimisticOrder[blockKey];
    const resolved = resolveColumnOrder(tableColumns, storedOrder ?? undefined);
    return selectVisibleColumns(resolved, displayFilters.visibleColumnKeys);
  }, [canonicalNewLead, displayFilters.visibleColumnKeys, optimisticOrder, tableColumns]);

  /**
   * 검색 기준 컬럼 — 인가된 전체 active 컬럼 (보기에서 숨긴 칸 포함).
   * columnsForBlock(표시 전용)으로 검색하면 숨긴 칸의 텍스트·라벨·전화가 새지 않는다.
   * 서버가 이미 권한 밖 행을 빼고 준 rows만 대상으로 삼으므로 여기서
   * 허가받지 않은 데이터를 새로 조회하지는 않는다. +82 정규화는 filters가 유지한다.
   */
  const searchColumns = activeColumns;

  /** 보이는 순서대로 모은 전체 가시 행 id — 선택 교집합·내보내기·Shift 범위의 기준. */
  const visibleOrderedIds = useMemo(() => {
    const ids: string[] = [];
    for (const block of blocks) {
      if (closedGroups.has(block.key)) continue;
      for (const row of applyFilters(block.rows, searchColumns, displayFilters, filterProjection, assigneeLabels)) {
        ids.push(row.id);
      }
    }
    return ids;
  }, [assigneeLabels, blocks, closedGroups, searchColumns, displayFilters, filterProjection]);

  const bulkTargetIds = useMemo(
    () => intersectVisibleSelection(selectedIds, visibleOrderedIds),
    [selectedIds, visibleOrderedIds],
  );
  const rowById = useMemo(() => new Map(displayRows.map((row) => [row.id, row])), [displayRows]);
  const bulkTargets = useMemo(
    () => bulkTargetIds.map((id) => ({ id, title: rowById.get(id)?.title ?? id })),
    [bulkTargetIds, rowById],
  );

  const toggleRow = useCallback((itemId: string, checked: boolean, shiftKey = false) => {
    setBulkNotice(null);
    const anchor = lastToggledRef.current;
    const ordered = visibleOrderedIds;
    if (shiftKey) {
      const range = bulkRangeIds(ordered, anchor, itemId);
      if (range.length > 0) {
        setSelectedIds((previous) => toggleGroupSelection(previous, range, checked));
        lastToggledRef.current = itemId;
        return;
      }
    }
    setSelectedIds((previous) => toggleSelection(previous, itemId, checked));
    lastToggledRef.current = itemId;
  }, [visibleOrderedIds]);
  const toggleGroupIds = useCallback((ids: readonly string[], checked: boolean) => {
    setBulkNotice(null);
    setSelectedIds((previous) => toggleGroupSelection(previous, ids, checked));
    if (ids.length > 0) lastToggledRef.current = checked ? ids[ids.length - 1] ?? null : lastToggledRef.current;
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBulkDialog(null);
    lastToggledRef.current = null;
  }, []);
  const openBulkDialog = useCallback((op: BulkOpKind, preset?: string) => {
    setBulkNotice(null);
    setBulkDialog({ op, preset });
  }, []);
  const applyBulkSucceeded = useCallback((succeededIds: string[]) => {
    if (succeededIds.length === 0) return;
    const done = new Set(succeededIds);
    setSelectedIds((previous) => {
      const next = new Set<string>();
      for (const id of previous) if (!done.has(id)) next.add(id);
      return next;
    });
  }, []);

  // 일괄 대화상자에 내보이는 컬럼 — 편집 가능하고 불투명 전이 열이 아닌 것만.
  const BULK_FIELD_TYPES = useMemo(() => new Set([
    "text", "number", "money", "date", "datetime", "email", "url", "phone",
    "select", "status", "person",
  ]), []);
  const bulkStatusColumn = useMemo(
    () => pickBulkStatusColumn(physicalActiveColumns, workflowProgressKind),
    [physicalActiveColumns, workflowProgressKind],
  );
  const bulkFieldColumns = useMemo(
    () => tableColumns
      .filter((column) =>
        BULK_FIELD_TYPES.has(column.type)
        && isSourceEditable(column.source)
        && column.is_readonly !== true
        && !BULK_BLOCKED_COLUMN_KEYS.has(column.key)
        && column.key !== WORKFLOW_PROGRESS_KEY)
      .map((column) => ({
        key: column.key,
        label: column.label,
        type: column.type,
        options: column.type === "select" || column.type === "status"
          ? (column.options_jsonb?.options ?? [])
            .filter((option) => !BULK_BLOCKED_VALUES.has(option.id))
            .map((option) => ({ id: option.id, label: option.label }))
          : undefined,
      })),
    [BULK_FIELD_TYPES, tableColumns],
  );
  const bulkDateColumns = useMemo(
    () => tableColumns
      .filter((column) =>
        (column.type === "date" || column.type === "datetime")
        && isSourceEditable(column.source)
        && column.is_readonly !== true)
      .map((column) => ({
        key: column.key,
        label: column.label,
        includeTime: column.type === "datetime",
      })),
    [tableColumns],
  );
  // scheduleRecipients(아래 정의)와 같은 원천 — 담당자 탭·일괄이 같은 사람을 본다.
  const bulkMembers = useMemo(
    () => memberDirectory?.length
      ? memberDirectory.map((member) => ({ id: member.id, label: member.label }))
      : Object.entries(assigneeLabels).map(([id, label]) => ({ id, label: label || "이름 없는 구성원" })),
    [assigneeLabels, memberDirectory],
  );
  const bulkTargetValues = useMemo(() => {
    const wanted = new Set([
      ...bulkFieldColumns.map((column) => column.key),
      ...bulkDateColumns.map((column) => column.key),
    ]);
    const out: Record<string, Record<string, import("@/lib/boards/types").CellValue>> = {};
    for (const id of bulkTargetIds) {
      const row = rowById.get(id);
      if (!row) continue;
      out[id] = Object.fromEntries(
        [...wanted].filter((key) => key in row.values).map((key) => [key, row.values[key] ?? null]),
      );
    }
    return out;
  }, [bulkDateColumns, bulkFieldColumns, bulkTargetIds, rowById]);

  // 내보내기 — 표시 라벨(헤더)과 표시 텍스트(셀)만. 담당자는 이름으로 푼다.
  // 진행현황은 투영된 인간 라벨로 포함한다 — 합성 키를 빼면 워크플로 보드의 진행이 통째로 사라진다.
  const bulkExport = useMemo(() => {
    const visibleKeys = displayFilters.visibleColumnKeys ?? null;
    const exportColumns = tableColumns.filter((column) =>
      (visibleKeys === null || visibleKeys.includes(column.key)));
    const optionLookup = new Map<string, { id: string; label: string }[]>();
    for (const column of [...columns, ...tableColumns]) {
      if (!optionLookup.has(column.key)) {
        optionLookup.set(column.key, column.options_jsonb?.options ?? []);
      }
    }
    const headers = ["이름", ...exportColumns.map((column) => column.label)];
    const lines = bulkTargetIds.map((id) => {
      const row = rowById.get(id);
      if (!row) return [id];
      return [
        row.title,
        ...exportColumns.map((column) => {
          const value = row.values[column.key] ?? null;
          if (column.type === "person" && typeof value === "string") {
            return assigneeLabels[value] ?? value;
          }
          if (column.type === "people" && Array.isArray(value)) {
            return value
              .map((entry) => typeof entry === "string" ? (assigneeLabels[entry] ?? entry) : String(entry))
              .join(", ");
          }
          return formatCell(column.type, value, optionLookup.get(column.key) ?? undefined);
        }),
      ];
    });
    return {
      csv: selectionToCsv(headers, lines),
      filename: `board-${board.id}-selection.csv`,
    };
  }, [assigneeLabels, board.id, bulkTargetIds, columns, displayFilters.visibleColumnKeys, rowById, tableColumns]);

  const companyPickerProps = buildCompanyPickerProps(
    board.source,
    contractWorkCompanyPicker,
    startCompanyWorkAction,
  );
  const people = useMemo(() => assigneeOptions(rows, assigneeLabels), [rows, assigneeLabels]);
  const scheduleItems = useMemo(() => displayRows.map((row) => ({ id: row.id, label: row.title })), [displayRows]);
  const scheduleRecipients = useMemo(
    () => memberDirectory?.length
      ? memberDirectory
      : Object.entries(assigneeLabels).map(([id, label]) => ({ id, label: label || "이름 없는 구성원" })),
    [assigneeLabels, memberDirectory],
  );

  const matched = useMemo(
    () => workflowProgressKind
      ? applyFilters(displayRows, searchColumns, displayFilters, filterProjection, assigneeLabels).length
      : applyFilters(optimisticRows, searchColumns, displayFilters, filterProjection, assigneeLabels).length,
    [assigneeLabels, displayFilters, displayRows, filterProjection, optimisticRows, searchColumns, workflowProgressKind],
  );
  const saveSummary = useCallback(async (request: BoardSummarySettingsRequest) => {
    const result = await saveBoardSummarySettingsAction(board.id, request);
    if (result.ok) setSummaryConfig(parseBoardSummaryConfig(result.config));
    return result;
  }, [board.id]);

  /** 도구줄 담당자 필터 ↔ 헤더 담당자 탭의 단일 소스. null = 전체. */
  const pickAssignee = (value: string | null) =>
    setFilters((f) => ({ ...f, assignees: value === null ? [] : [value] }));

  const handleColumnDrop = (
    groupKey: string,
    /** 그 그룹의 **전체** 컬럼 순서(컬럼수 제한 적용 전). */
    fullColumns: BoardColumn[],
    draggedKey: string,
    targetKey: string,
  ) => {
    const keys = reorderColumnKeys(fullColumns, draggedKey, targetKey);
    startTransition(async () => {
      setOrderOptimistic({ groupKey, keys });
      const fd = new FormData();
      fd.set("boardId", board.id);
      fd.set("groupKey", groupKey);
      fd.set("order", (canonicalNewLead ? durableNewLeadColumnKeys(keys) : keys).join(","));
      await setGroupColumnOrderAction(fd);
    });
  };
  const handleColumnKeyboardMove=(groupKey:string,fullColumns:BoardColumn[],columnKey:string,delta:number)=>{
    const keys=fullColumns.map((column)=>column.key);
    const from=keys.indexOf(columnKey);const to=Math.max(0,Math.min(keys.length-1,from+delta));
    if(from<0||from===to)return;
    const [moved]=keys.splice(from,1);keys.splice(to,0,moved);
    startTransition(async()=>{
      setOrderOptimistic({groupKey,keys});
      const fd=new FormData();fd.set("boardId",board.id);fd.set("groupKey",groupKey);
      fd.set("order",(canonicalNewLead?durableNewLeadColumnKeys(keys):keys).join(","));
      await setGroupColumnOrderAction(fd);
    });
  };

  /**
   * 보이는 목록 기준 인덱스 → 그룹 전체 기준 인덱스.
   * 드롭 지점의 바로 아래 행(anchor)이 전체 목록에서 몇 번째인지로 환산한다.
   * 목록 끝에 놓았으면 anchor 가 없으므로 전체 길이가 된다.
   */
  const toFullIndex = (
    fullRows: readonly ItemWithValues[],
    visibleRows: readonly ItemWithValues[],
    visibleIndex: number,
    movingId: string,
  ): number => {
    const anchor = visibleRows[visibleIndex];
    const withoutMoving = fullRows.filter((r) => r.id !== movingId);
    if (!anchor) return withoutMoving.length;
    const at = withoutMoving.findIndex((r) => r.id === anchor.id);
    return at < 0 ? withoutMoving.length : at;
  };

  const startRowDrag = useCallback((itemId: string) => {
    dragRowRef.current = itemId;
    setDragRowId(itemId);
    setMoveNotice("이동할 위치를 선택하세요.");
  }, []);

  const endRowDrag = useCallback(() => {
    dragRowRef.current = null;
    setDragRowId(null);
  }, []);

  const canDropRow = useCallback(
    () => rowDragEnabled && dragRowRef.current !== null,
    [rowDragEnabled],
  );

  const persistRowMove = useCallback((itemId:string,groupId:string|null,beforeItemId:string|null,index:number)=>{
    if(rowMoveInFlightRef.current){setMoveNotice("이전 이동을 저장하고 있어요.");return false;}
    rowMoveInFlightRef.current=true;
    setRowMovePending(true);
    const intentKey=JSON.stringify({itemId,groupId,beforeItemId});
    if(rowMoveIntentRef.current?.key!==intentKey)rowMoveIntentRef.current={key:intentKey,requestId:crypto.randomUUID(),expectedVersion:rowOrderVersionRef.current};
    const {requestId,expectedVersion}=rowMoveIntentRef.current;
    startTransition(async()=>{
      moveRowOptimistic({itemId,groupId,index});
      try{
        const fd=new FormData();
        fd.set("boardId",board.id);fd.set("itemId",itemId);fd.set("groupId",groupId??"");
        fd.set("beforeItemId",beforeItemId??"");fd.set("expectedVersion",String(expectedVersion));
        fd.set("requestId",requestId);fd.set("eventKey",requestId);
        const result=await moveRowAction(fd);
        if(result.ok){rowMoveIntentRef.current=null;rowOrderVersionRef.current=Math.max(result.version,latestRowOrderVersionPropRef.current);setMoveNotice(result.replayed?"이미 저장된 이동을 확인했습니다.":"행 순서를 저장했습니다.");}
        else{if(result.stale)rowMoveIntentRef.current=null;setMoveNotice(result.message);}
      }catch{
        setMoveNotice("행 이동을 저장하지 못했어요. 현재 순서를 다시 확인해 주세요.");
      }finally{
        rowMoveInFlightRef.current=false;
        rowOrderVersionRef.current=Math.max(rowOrderVersionRef.current,latestRowOrderVersionPropRef.current);
        setRowMovePending(false);
      }
    });
    return true;
  },[board.id,moveRowOptimistic]);

  const handleRowDrop = (
    groupId: string | null,
    fullRows: readonly ItemWithValues[],
    visibleRows: readonly ItemWithValues[],
    visibleIndex: number,
  ) => {
    const itemId = dragRowRef.current;
    endRowDrag();
    if (!itemId || !rowDragEnabled) return;

    const anchor=visibleRows[visibleIndex];
    if(anchor?.id===itemId){setMoveNotice("같은 위치에는 놓을 수 없어요.");return;}

    const index = toFullIndex(fullRows, visibleRows, visibleIndex, itemId);
    persistRowMove(itemId,groupId,anchor?.id??null,index);
  };

  const keyboardMoveRow=(rowId:string,groupId:string|null,visibleRows:readonly ItemWithValues[],direction:"up"|"down")=>{
    if(!rowDragEnabled){setMoveNotice(rowMoveInFlightRef.current?"이전 이동을 저장하고 있어요.":sortActive?"정렬 중에는 행 순서를 바꿀 수 없어요.":"행을 옮길 권한이 없어요.");return;}
    const at=visibleRows.findIndex((row)=>row.id===rowId);
    if(at<0)return;
    const targetIndex=direction==="up"?at-1:at+2;
    if(targetIndex<0||targetIndex>visibleRows.length){setMoveNotice("더 이동할 수 없어요.");return;}
    const anchor=visibleRows[targetIndex];
    const fullRows=blocks.find((block)=>block.group?.id===groupId)?.rows??[];
    persistRowMove(rowId,groupId,anchor?.id??null,toFullIndex(fullRows,visibleRows,targetIndex,rowId));
  };

  const keyboardMoveRowToGroup=(rowId:string,targetGroupId:string|null)=>{
    if(!rowDragEnabled){setMoveNotice(rowMoveInFlightRef.current?"이전 이동을 저장하고 있어요.":"지금은 행을 다른 그룹으로 옮길 수 없어요.");return;}
    const target=blocks.find((block)=>(block.group?.id??null)===targetGroupId);
    persistRowMove(rowId,targetGroupId,null,target?.rows.length??0);
  };

  return (
    /*
     * 원칙 2·8 — 인위적 max-width 없이 뷰포트 폭을 그대로 쓴다.
     * 세로 여백(gap-3)은 "그룹 사이 구획"이라는 위계 표현으로만 쓴다(원칙 10).
     */
    <div className="flex w-full min-w-0 max-w-full flex-col gap-3 overflow-x-hidden">
      <BoardHeader
        boardId={board.id}
        icon={board.icon}
        name={board.name}
        description={board.description}
        people={people}
        selected={filters.assignees}
        onSelect={pickAssignee}
        groups={groups}
        readOnly={readOnly}
        canEditTitle={!board.is_system&&canManageSummaries}
        backSlot={backSlot}
        helpSlot={onboardingSlot}
        viewSlot={viewSlot}
        addItemSlot={board.source === NEW_LEAD_TAB_SOURCE && groups[0] ? (
          <NewLeadIntakeForm
            variant="header"
            boardId={board.id}
             groupId={groups[0].id}
             groups={groups.map((group)=>({id:group.id,name:group.name}))}
            members={scheduleRecipients}
            currentUserId={currentUserId}
          />
        ) : undefined}
      />

      {/* 보드 이름 «아래» · 필터 «위» — 목업 head() 의 `.vrow` 자리다 (BBE-214). */}
      {savedViewsSlot}

      {settingsSlot ? <div data-visual-block="board-settings">{settingsSlot}</div> : null}

      <BoardToolbar
        columns={tableColumns}
        rows={displayRows}
        filters={displayFilters}
        onChange={setFilters}
        matched={matched}
        total={displayRows.length}
        people={people}
        legacyFacetLabels={canonicalNewLead ? NEW_LEAD_LEGACY_FACET_LABELS : undefined}
      />

      {readOnly && (
        <p className="rounded-lg border border-mw-line bg-mw-tint-blue px-3 py-2 text-xs text-mw-body">
          시스템 보드입니다. 정책자금 파이프라인의 딜·정산은 전용 화면에서 관리합니다(구조 편집 불가).
        </p>
      )}

      {sortActive && !readOnly && (
        <p className="text-xs text-mw-sub">
          정렬이 켜져 있어 행 드래그를 잠갔습니다. 직접 배치하려면 정렬을 «기본 순서»로 되돌리세요.
        </p>
      )}
      {selectedIds.size > 0 || bulkDialog !== null ? (
        <BulkActionBar
          boardId={board.id}
          workflowKind={workflowProgressKind}
          totalSelected={selectedIds.size}
          targets={bulkTargets}
          targetValues={bulkTargetValues}
          canEdit={!readOnly && canBulkEditItems}
          canMove={canMoveRows}
          canDelete={!board.is_system && canDeleteItems && canBulkEditItems}
          canExport={canExportItems}
          statusColumn={bulkStatusColumn}
          fieldColumns={bulkFieldColumns}
          dateColumns={bulkDateColumns}
          members={bulkMembers}
          groups={orderedGroups.map((group) => ({ id: group.id, name: group.name }))}
          exportCsv={bulkExport.csv}
          exportFilename={bulkExport.filename}
          dialog={bulkDialog}
          notice={bulkNotice}
          onOpenDialog={openBulkDialog}
          onCloseDialog={() => setBulkDialog(null)}
          onClear={clearSelection}
          onApplied={applyBulkSucceeded}
          onNotice={setBulkNotice}
        />
      ) : bulkNotice ? (
        <p role="status" className="rounded-lg border border-mw-line bg-mw-card px-3 py-2 text-xs text-mw-body">
          {bulkNotice}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" role={moveNotice?.includes("못")||moveNotice?.includes("없")?"alert":"status"}>{moveNotice}</p>

      {archivedColumnIds.size > 0 ? (
        <div role="status" className="flex items-center justify-between rounded-lg border border-mw-line bg-mw-card px-3 py-2 text-sm shadow">
          <span>컬럼을 휴지통으로 옮겼습니다. 값과 설정은 보존됩니다.</span>
          <button
            type="button"
            disabled={restoring}
            className="rounded border px-3 py-1 font-medium disabled:opacity-50"
            onClick={() => {
              const columnId = archivedColumnIds.values().next().value;
              if (!columnId) return;
              setRestoringColumnId(columnId);
              const data = new FormData();
              data.set("boardId", board.id);
              data.set("columnId", columnId);
              data.set("operation", "restore");
              data.set("requestId", crypto.randomUUID());
              startTransition(async () => {
                setRestoring(true);
                const result = await runColumnCommandAction(INITIAL_COLUMN_COMMAND_STATE, data);
                setRestoring(false);
                if (result.ok) {
                  setRestoreError(null);
                  setArchivedColumnIds((current) => {
                    const next = new Set(current);
                    next.delete(columnId);
                    return next;
                  });
                } else setRestoreError(result.message);
                setRestoringColumnId(null);
              });
            }}
          >{restoring && restoringColumnId ? "복구 중…" : "되돌리기"}</button>
        </div>
      ) : null}
      {restoreError ? <p role={noticeRole(false)} aria-live={noticeLive(false)} className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{restoreError}</p> : null}

      <BoardScrollViewport>
      {blocks.length === 0 ? (
        /* 원칙 5 — 화면 전체를 차지하는 빈 상태 금지. 한 줄 + 다음 행동. */
        <p className="rounded-md border border-dashed border-mw-line px-3 py-4 text-xs text-mw-sub">
          그룹이 없습니다. 아래 «그룹 추가»로 첫 그룹을 만드세요.
        </p>
      ) : (
        blocks.map((block) => {
          const storedOrder = canonicalNewLead
            ? presentNewLeadColumnKeys(optimisticOrder[block.key])
            : optimisticOrder[block.key];
          const resolvedColumns = resolveColumnOrder(tableColumns, storedOrder ?? undefined);
          // 과거에 저장된 그룹별 배치도 광고 명의 필수 유입정보 위치를 되돌리지 못하게 한다.
          // 서버의 sort_order와 그룹별 사용자 배치를 정본으로 삼는다. 기본 신규리드 순서는
          // revision installer가 안전하게 재배치하며, 회사가 직접 바꾼 순서는 여기서 덮지 않는다.
          const shown = columnsForBlock(block.key);
          // 검색(q)은 인가된 전체 active 컬럼을 대상으로 삼는다 — UI 열 숨김은 권한 숨김이 아니다.
          const visibleRows = applyFilters(block.rows, searchColumns, displayFilters, filterProjection, assigneeLabels);
          const summaryScope = savedViewActive
            ? { kind: "saved-view" as const, totalCount: block.rows.length }
            : activeFilterCount(displayFilters) > 0
              ? { kind: "filtered" as const, totalCount: block.rows.length }
              : { kind: "all" as const, totalCount: block.rows.length };
          const rawBoardDetailLayout = resolveBoardDetailLayout(
            board.source,
            board.detail_layout_jsonb,
            physicalDetailColumns,
          );
          const boardDetailLayout = canonicalNewLead
            ? presentNewLeadDetailLayout(rawBoardDetailLayout)
            : rawBoardDetailLayout;
          const rawResolvedDetailLayout = resolveDetailLayout(
            rawBoardDetailLayout,
            block.group?.detail_layout_jsonb,
          );
          const presentedDetailLayout = canonicalNewLead
            ? presentNewLeadDetailLayout(rawResolvedDetailLayout.entries)
            : rawResolvedDetailLayout.entries;
          // `start_company_work`는 정본상 첫 그룹에 넣는다. 다른 그룹 아래에도 선택기를
          // 보여주면 누른 위치와 생성 위치가 달라지므로 첫 그룹에만 둔다.

          return (
            <GroupBlock
              open={!closedGroups.has(block.key)}
              onOpenChange={(open) => setClosedGroups((current) => {
                if (current.has(block.key) === !open) return current;
                const next = new Set(current);
                if (open) next.delete(block.key); else next.add(block.key);
                return next;
              })}
              key={block.key}
              name={block.name}
              color={block.color}
              columns={shown}
              rows={visibleRows}
              presetName={groupPresetName(board.name, block.name)}
              presetChanged={isGroupPresetChanged(optimisticOrder[block.key])}
              nameEditor={block.group && !board.is_system && canManageSections ? <GroupNameEditor boardId={board.id} groupId={block.group.id} name={block.name} /> : undefined}
              onOrderDragStart={block.group && !board.is_system && canManageSections ? () => { claimBoardTransientSurface(`board:${board.id}`,`group-drag:${board.id}`);draggedGroupRef.current = block.group!.id;setMoveNotice("그룹을 놓을 위치를 선택하세요."); } : undefined}
              onOrderDragEnd={block.group && !board.is_system && canManageSections ? ()=>{draggedGroupRef.current=null;setMoveNotice(null);} : undefined}
              onOrderDrop={block.group && !board.is_system && canManageSections ? () => dropGroup(block.group!.id) : undefined}
              canOrderDrop={block.group&&!board.is_system&&canManageSections?()=>draggedGroupRef.current!==null&&draggedGroupRef.current!==block.group!.id:undefined}
              summarySlot={
                <BoardSummaryStrip
                  config={summaryConfig}
                  columns={activeSummaryColumns}
                  rows={visibleRows}
                  coverage={{ state: "complete" }}
                  scope={summaryScope}
                  formatValue={(value, type) => `${formatCell(type, value)}${type === "money" ? "원" : ""}`}
                  settings={
                    <BoardSummarySettingsPopover
                      config={summaryConfig}
                      columns={activeSummaryColumns}
                      canEdit={!board.is_system && canManageSummaries}
                      onSubmit={saveSummary}
                    />
                  }
                />
              }
              orderControls={block.group && !board.is_system && canManageSections ? (
                <span className="inline-flex" aria-label={`${block.name} 그룹 순서`}>
                  <button type="button" aria-label={`${block.name} 위로 이동`} onClick={() => moveGroup(block.group!.id, -1)} className="rounded px-1 focus:outline-none focus:ring-2 focus:ring-mw-primary">↑</button>
                  <button type="button" aria-label={`${block.name} 아래로 이동`} onClick={() => moveGroup(block.group!.id, 1)} className="rounded px-1 focus:outline-none focus:ring-2 focus:ring-mw-primary">↓</button>
                </span>
              ) : undefined}
            >
              <GroupTable
                boardId={board.id}
                boardName={board.name}
                groupName={block.name}
                canonicalNewLead={canonicalNewLead}
                newLeadMembers={scheduleRecipients}
                {...companyPickerProps}
                itemDetailFixture={itemDetailFixture}
                currentUserId={currentUserId}
                groupId={block.group?.id ?? null}
                columns={shown}
                detailColumns={[...detailColumns]}
                boardDetailLayout={boardDetailLayout}
                durableDetailColumns={[...physicalDetailColumns]}
                durableBoardDetailLayout={rawBoardDetailLayout}
                durableDetailLayout={rawResolvedDetailLayout.entries}
                detailLayout={presentedDetailLayout.filter(
                  (entry) => entry.source === "detail" || detailColumns.some((column) => column.key === entry.key),
                )}
                detailLayoutInherited={rawResolvedDetailLayout.inherited}
                rows={visibleRows}
                textMode={savedPresentation.textMode}
                focusColumnKey={savedPresentation.focusColumnKey}
                readOnly={readOnly}
                canDeleteItems={!board.is_system && canDeleteItems}
                authorColumnKey={authorColumnKey}
                viewerUserId={currentUserId}
                canManageColumns={!board.is_system && canManageColumns}
                onColumnArchived={(columnId) => setArchivedColumnIds((current) => new Set(current).add(columnId))}
                scheduleItems={scheduleItems}
                scheduleRecipients={scheduleRecipients}
                rowDragEnabled={rowDragEnabled}
                cellFlash={cellFlash}
                cellAction={cellAction}
                workflowProgressKind={workflowProgressKind}
                onColumnDrop={(draggedKey, targetKey) =>
                  handleColumnDrop(block.key, resolvedColumns, draggedKey, targetKey)
                }
                onColumnKeyboardMove={(columnKey,delta)=>handleColumnKeyboardMove(block.key,resolvedColumns,columnKey,delta)}
                dragRowId={rowDragEnabled ? dragRowId : null}
                canDropRow={canDropRow}
                selection={selectedIds}
                onToggleRow={toggleRow}
                onToggleGroup={(checked) => toggleGroupIds(visibleRows.map((row) => row.id), checked)}
                onBulkStatusRequest={(rowId, columnKey, preset) => {
                  if (!canBulkEditItems) return false;
                  const decision = decideBulkIntercept({
                    selectedSize: selectedIds.size,
                    isSelectedRow: selectedIds.has(rowId),
                    columnKey,
                    workflowKind: workflowProgressKind,
                    statusColumnKey: bulkStatusColumn?.key ?? null,
                    fieldColumns: bulkFieldColumns,
                  });
                  if (decision === "status") {
                    openBulkDialog("status", preset);
                    return true;
                  }
                  if (decision === "fields") {
                    setBulkNotice(null);
                    setBulkDialog({ op: "fields", fieldKey: columnKey, fieldValue: preset });
                    return true;
                  }
                  return false;
                }}
                onRowDragStart={startRowDrag}
                onRowDragEnd={endRowDrag}
                onRowDrop={(index) =>
                  handleRowDrop(block.group?.id ?? null, block.rows, visibleRows, index)
                }
                onRowKeyboardMove={(rowId,direction)=>keyboardMoveRow(rowId,block.group?.id??null,visibleRows,direction)}
                onRowMoveToGroup={keyboardMoveRowToGroup}
                groupMoveOptions={orderedGroups.map((group)=>({id:group.id,name:group.name}))}
                renderWorkflowTransition={board.source === CONTACT_TAB_SOURCE ? (row) => (
                  workflowTransitionSlot ?? (
                    <ContactPipelineAction
                      dealId={null}
                      kind="contact_to_work"
                      requestId={row.id}
                      sourceBoardId={board.id}
                      initialCompanyName={row.title}
                      initialValues={{
                        bizNo: String(row.values.biz_no ?? row.values.biz_reg_no ?? ""),
                        ceoName: String(row.values.rep_name ?? ""),
                        bizType: String(row.values.biz_reg_type ?? ""),
                        industry: String(row.values.industry ?? ""),
                        regionSido: String(row.values.sido ?? ""),
                        regionSigungu: String(row.values.sigungu ?? ""),
                        phone: String(row.values.phone ?? ""),
                        foundedOn: companyFoundedOn(row.values.founded_year),
                        revenue: companyRevenue(row.values.revenue),
                      }}
                    />
                  )
                ) : undefined}
              />
            </GroupBlock>
          );
        })
      )}
      </BoardScrollViewport>
    </div>
  );
}
