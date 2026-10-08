"use client";

import { consultationPhase, REMOTE_PHASES, INPERSON_PHASES, CONSULTATION_PHASE_LABEL } from "@/lib/consultation/phases";

/**
 * 보드 화면 셸 — 헤더 1줄 + 보기 줄 1줄(#845 6단계 BoardViewBar) + **블록 리스트** (PLAN-002 WO-2).
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
 *
 * #845 7단계 — 나눠 보기. 사람·목록·상태 칸을 고르면 블록이 «보드» 대신 그 칸의 «값 묶음» 이 된다
 * (buildValueBlocks). 그때 행을 다른 묶음으로 끌면 순서가 아니라 그 칸의 값을 바꾼다(setGroupValueAction ·
 * 낙관적 + 실패 시 되돌림). 묶음 안의 순서는 저장하지 않는다(보이는 순서 = 보드 순서 또는 줄 세우기).
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
import type { Board, BoardColumn, BoardGroup, CellValue, ItemWithValues } from "@/lib/boards/types";
import type { CellFlash } from "@/lib/boards/cellFlash";
import { boardCellValueFromFormData } from "@/lib/boards/form-values";
import { applySavedItems, cellSaveMessage, patchCellValue, type CellSaveResult } from "@/lib/boards/cell-save-result";
import { saveCellValueAction } from "@/app/(app)/boards/cell-save-actions";
import { CellSaveContext, type CellSaveApi } from "./cell-save-context";
import { useRouter } from "next/navigation";
import {
  moveRowAction,
  reorderGroupsAction,
  setGroupColumnOrderAction,
  setGroupColumnOrdersAction,
  setGroupValueAction,
} from "@/app/(app)/boards/actions";
import { BoardHeader } from "./BoardHeader";
import { TabChromeProvider, type TabSettingsSection } from "./tab-chrome";
import { selectionTriState } from "./bulk-selection";
import { BoardScrollViewport } from "./BoardScrollViewport";
import { BoardViewBar } from "./BoardViewBar";
import { hasToolbarFacet, type ToolbarFilterFocus } from "./ViewConditionsPanel";
import { columnPlainName, type ColumnViewRequest } from "./column-menu-model";
import { GroupBlock, GroupSelectAll } from "./GroupBlock";
import { GroupNameEditor } from "./GroupNameEditor";
import { claimBoardTransientSurface } from "./BoardAnchoredMenu";
import { GroupTable } from "./GroupTable";
import { ItemTrashUndoToast } from "./ItemTrashUndo";
import type { MemberPickerMember } from "./MemberPicker";
import { NewLeadIntakeForm } from "./NewLeadIntakeForm";
import { useDeferredDragReveal } from "./use-deferred-drag-reveal";
import { groupPresetName, isGroupPresetChanged } from "@/lib/presets/group-preset";
import { ContactPipelineAction } from "@/components/crm/ContactPipelineAction";
import { ConsultationPanel } from "@/components/consultation/ConsultationPanel";
import {
  CONSULTATION_PROGRESS_KEY,
  consultationModeForRow,
  contractStepGroupKey,
  CONTRACT_STEP_GROUPS,
  withRowContractFee,
  type ConsultationBoardMap,
  type ConsultationView,
} from "@/lib/consultation/boardView";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE, NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import type { CompanyPickerLoadResult } from "@/lib/companies/picker-server";
import { buildCompanyPickerProps } from "@/lib/companies/picker-props";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";
import type { AddLabelOptionInput, AddLabelOptionResult } from "@/app/(app)/boards/label-option-actions";
import {
  durableNewLeadColumnKeys,
  NEW_LEAD_DETAIL_ONLY_KEYS,
  newLeadPresentationKey,
  presentNewLeadColumnKeys,
  presentNewLeadColumns,
  presentNewLeadDetailLayout,
} from "@/lib/default-tabs/new-lead";
import { NOTICE_KEYS } from "@/lib/notices/types";
import {
  buildBlocks,
  buildNewLeadStageBlocks,
  buildValueBlocks,
  durableNewLeadBlockKey,
  valueBlockKey,
  type BoardBlock,
} from "./blocks";
import {
  groupValueEditBlock,
  isTableGroupColumn,
  movedGroupValue,
  ownerModeForSource,
  prefillGroupValue,
} from "@/lib/view/group-by";
import {
  groupKeyOf,
  reorderColumnKeys,
  resolveColumnOrder,
  UNGROUPED_KEY,
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
import { resolveBoardDetailLayout, resolveDetailLayout, resolveRowDetailLayout } from "@/lib/boards/detail-layout";
import type { ItemDetailSnapshot } from "@/app/(app)/boards/item-detail-actions";
import { runColumnCommandAction } from "@/app/(app)/boards/column-command-actions";
import { INITIAL_COLUMN_COMMAND_STATE } from "@/app/(app)/boards/column-command-state";
import { noticeLive, noticeRole, type ResultNotice } from "@/lib/ui/result-notice";
import {
  presentWorkflowProgressColumns,
  withWorkflowProgressValues,
  workflowDetailHiddenKeys,
  workflowKindForSource,
  workflowStageMoveTargets,
} from "@/lib/workflow/progress";
import { presentLabel, presentLabels } from "@/lib/boards/label-presentation";
import { groupToneAccent, resolveGroupTones } from "@/lib/boards/group-tone";
import { primaryStageForGroup } from "@/lib/boards/moveRules";
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
import { canCreateLabelForColumn, newLabelRequestId } from "@/lib/boards/label-options";
import { WORKFLOW_PROGRESS_KEY } from "@/lib/workflow/progress";
import { BoardSummaryStrip } from "./BoardSummaryStrip";
import { BoardSummarySettingsPopover } from "./BoardSummarySettingsPopover";
import { formatCell } from "@/lib/boards/cells";
import { parseBoardSummaryConfig, type BoardSummarySettingsRequest } from "@/lib/boards/summary-settings";
import { saveBoardSummarySettingsAction } from "@/app/(app)/boards/[id]/summary-actions";

const NEW_LEAD_LEGACY_FACET_LABELS = { revenue_band: "기존 매출구간" } as const;
const NO_COLUMN_KEYS: readonly string[] = [];

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

/**
 * 주소의 보기 조건(mwFilters · group)만 바꾼다 — 화면은 다시 받지 않는다.
 * ★ 상태는 null 로 넘긴다(ItemDetailPanel.pushItemDetailHash 와 같은 이유). Next 가 넣어 둔 history.state 를
 *   그대로 넘기면 그 표식(__NA) 때문에 Next 가 «자기가 쓴 기록» 으로 보고 라우터 주소를 맞추지 않는다.
 *   그러면 칸 저장 뒤의 조용한 새로 받기(router.refresh)·묶음 끌기의 revalidate 가 옛 주소로 되돌려
 *   ?group= 이 주소창에서 사라진다. null 이면 Next 가 이 주소를 라우터 상태로 받아 둔다.
 */
function replaceBoardUrl(url: URL) {
  window.history.replaceState(null, "", url);
}

/** Issue 857 — 셀 저장이 이만큼 멈추면 화면 데이터를 조용히 새로 받는다. */
const CELL_SAVE_QUIET_REFRESH_MS = 2000;

/**
 * Issue 857 — 칸 저장이 화면에 얹어 둔 것. 행 id(칸 한 줄은 행 id + 칸 key)로 든다.
 *   saved    — 서버가 돌려준 행(그 판 = updated_at).
 *   messages — 칸 아래 한 줄(null = 지난 사유를 지움). 성공은 돌려받은 행의 판, 실패는 저장할 때 보던 행의 판을 든다.
 *   staleSeen — 저장한 판보다 «옛» 서버 화면을 몇 번 넘겼나.
 */
type SavedCellRow = { item: ItemWithValues; staleSeen: number };
type SavedCellMessage = { message: string | null; version: string; failed: boolean; staleSeen: number };
type CellSaveOverlay = {
  rows: ItemWithValues[];
  saved: Readonly<Record<string, SavedCellRow>>;
  messages: Readonly<Record<string, SavedCellMessage>>;
};

function cellMessageKey(itemId: string, columnKey: string): string {
  return `${itemId}\u0000${columnKey}`;
}

/** 행의 판(updated_at) → 비교할 수 있는 시각. 읽지 못하면 NaN(= 모름). */
function rowVersionTime(version: string | null | undefined): number {
  return typeof version === "string" && version ? Date.parse(version) : Number.NaN;
}

/** 서버 행이 저장한 판을 «따라잡았나»(같거나 새 판). 둘 중 하나라도 모르면 false. */
function serverCaughtUp(serverVersion: string | undefined, savedVersion: string): boolean {
  const server = rowVersionTime(serverVersion);
  const saved = rowVersionTime(savedVersion);
  return !Number.isNaN(server) && !Number.isNaN(saved) && server >= saved;
}

/** 아직 서버보다 앞선 저장 행만 — 서버가 따라잡은(같거나 새 판) 행은 서버 것을 그린다. */
function savedItemsAhead(
  rows: readonly ItemWithValues[],
  saved: Readonly<Record<string, SavedCellRow>>,
): Record<string, ItemWithValues> {
  const ids = Object.keys(saved);
  if (ids.length === 0) return {};
  const serverVersion = new Map(rows.map((row) => [row.id, row.updated_at]));
  const ahead: Record<string, ItemWithValues> = {};
  for (const id of ids) {
    if (!serverCaughtUp(serverVersion.get(id), saved[id].item.updated_at)) ahead[id] = saved[id].item;
  }
  return ahead;
}

/**
 * 서버가 화면을 새로 보냈을 때(rows 가 바뀜) 얹어 둔 것을 가린다 — #857 «언제나 서버가 이긴다» 를 지킨다.
 *   · 그 행을 같거나 새 판으로 보냈다 → 버린다(서버가 이긴다).
 *   · 옛 판이다 → 저장 «전» 에 출발한 응답(묶음 끌기의 revalidate 등)이다. 한 번은 얹은 것을 지킨다.
 *     두 번째 옛 판에서는 서버를 따른다 — 칸 저장(앱 서버 시계)과 행 이동(DB 시계)의 판이 어긋나
 *     새 값이 옛 판처럼 보여도 영영 가려지지 않게.
 *   · 판을 읽을 수 없거나 그 행이 없어졌다 → 버린다(예전처럼).
 * 실패 사유는 그 칸을 다시 저장하거나 서버가 그 행의 «더 새» 판을 보낼 때까지 둔다.
 */
function reconcileCellSaveOverlay(overlay: CellSaveOverlay, rows: ItemWithValues[]): CellSaveOverlay {
  const serverVersion = new Map(rows.map((row) => [row.id, row.updated_at]));
  const keepAhead = (itemId: string, version: string, staleSeen: number): boolean => {
    const server = serverVersion.get(itemId);
    if (Number.isNaN(rowVersionTime(server)) || Number.isNaN(rowVersionTime(version))) return false;
    return !serverCaughtUp(server, version) && staleSeen < 1;
  };
  const saved: Record<string, SavedCellRow> = {};
  for (const [itemId, entry] of Object.entries(overlay.saved)) {
    if (keepAhead(itemId, entry.item.updated_at, entry.staleSeen)) saved[itemId] = { ...entry, staleSeen: entry.staleSeen + 1 };
  }
  const messages: Record<string, SavedCellMessage> = {};
  for (const [key, entry] of Object.entries(overlay.messages)) {
    const itemId = key.slice(0, key.indexOf("\u0000"));
    if (entry.failed) {
      const server = rowVersionTime(serverVersion.get(itemId));
      const before = rowVersionTime(entry.version);
      if (!Number.isNaN(server) && !Number.isNaN(before) && server <= before) messages[key] = entry;
    } else if (keepAhead(itemId, entry.version, entry.staleSeen)) {
      messages[key] = { ...entry, staleSeen: entry.staleSeen + 1 };
    }
  }
  return { rows, saved, messages };
}

/** #845 7단계 — 나눠 보기에서 다른 묶음으로 끌어 놓은 행의 새 값(낙관적). */
interface RowValuePatch {
  itemId: string;
  columnKey: string;
  value: CellValue;
}

/**
 * 낙관적 행 이동 — 서버의 moveRowAction 과 같은 규칙(그룹 내 재색인)을 화면에서 미리 흉내낸다.
 * 나눠 보기의 값 바꾸기(RowValuePatch)는 그 행의 칸 값만 먼저 바꾼다.
 */
function rowMoveReducer(rows: ItemWithValues[], move: RowMove | RowValuePatch): ItemWithValues[] {
  if ("columnKey" in move) {
    return rows.map((row) => row.id === move.itemId
      ? { ...row, values: { ...row.values, [move.columnKey]: move.value } }
      : row);
  }
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
  viewMode = "table",
  groupBy = "",
  loadSavedViews = false,
  calendarAvailable = false,
  tabSettingsSlot,
  tabSettingsSections,
  tabTrashSlot,
  onboardingSlot,
  canEditItems = false,
  canDeleteItems = false,
  canBulkEditItems = false,
  canExportItems = false,
  canManageColumns = false,
  canManageSections = false,
  canManageSummaries = false,
  canMoveRows = false,
  editLockedColumnKeys = NO_COLUMN_KEYS,
  savedViewActive = false,
  savedViewId = null,
  currentUserId,
  cellAction,
  itemDetailFixture,
  workflowTransitionSlot,
  contractWorkCompanyPicker = { rows: [], error: null, truncated: false },
  startCompanyWorkAction,
  consultationView = "all",
  consultationByItem = {},
  startNewCompanyWorkAction,
  addLabelOptionAction,
}: {
  board: Board;
  /** 계약업체 실무에서만 채워진다 — 「＋ 업체 추가」 목록. 다른 보드는 빈 배열이다. */
  contractWorkCompanyPicker?: CompanyPickerLoadResult;
  startCompanyWorkAction?: (
    previous: CompanyIntakeActionState,
    formData: FormData,
  ) => Promise<CompanyIntakeActionState>;
  /** 2026-09-26 — «새 회사» 등록 + 업무 시작. 없어도 기존 회사 경로는 그대로 돈다. */
  startNewCompanyWorkAction?: (
    previous: CompanyIntakeActionState,
    formData: FormData,
  ) => Promise<CompanyIntakeActionState>;
  /** 2026-09-26 — 셀 드롭다운의 «라벨 만들기». 없으면 만들기 행이 안 보인다. */
  addLabelOptionAction?: (input: AddLabelOptionInput) => Promise<AddLabelOptionResult>;
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
  /** 헤더 1줄 안에 얹을 화면 고유 컨트롤(뒤로가기) — 줄을 늘리지 않기 위한 슬롯. */
  backSlot?: ReactNode;
  /**
   * #845 6단계 — 보드 이름 아래 «보기 줄» 하나(뷰 탭 · 보기 조건 칩 · 저장 · 찾기)가 예전의
   * 저장된 뷰 줄 · 머리말 둘째 줄 · 도구줄을 대신한다. 이 화면은 메인 표(?view=table)다.
   */
  viewMode?: "table";
  /** 주소의 나눠 보기(?group=). 표는 다음 단계에서 이 값으로 묶는다. */
  groupBy?: string;
  /** 저장된 뷰를 /api/tab-views 에서 읽는다. 화면 fixture·시험은 끈다. */
  loadSavedViews?: boolean;
  /** 날짜 칸이 있어 캘린더로 볼 수 있는가. */
  calendarAvailable?: boolean;
  /**
   * #845 개선안(2026-10-08) — 머리말 오른쪽 위 「탭 설정」 이 여는 대화상자(일반·항목·단계).
   * 옛 「⚙ 보드 설정」 펼침을 대신한다. 열림 상태는 TabChromeProvider 가 들고 문맥으로 알린다.
   * `tabSettingsSections` 가 비면 「탭 설정」 단추·▾ 설정 항목이 없다(권한 없음·시스템 보드).
   */
  tabSettingsSlot?: ReactNode;
  /** 이 탭에서 열 수 있는 설정 칸 — 화면이 권한으로 정한다. */
  tabSettingsSections?: readonly TabSettingsSection[];
  /** #845 개선안 — 제목 ▾ 「휴지통으로 이동」 확인. 없으면 메뉴에서 감춘다(지울 권한 없음·시스템 보드). */
  tabTrashSlot?: ReactNode;
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
  /**
   * 칸의 편집 제한(edit_policy_jsonb, 예: 「관리자만」)이 이 사람에게 닫힌 칸 key — 서버가 columnPolicyAllows 로
   * 판정해 넘긴다(화면은 역할을 모른다). 나눠 보기의 끌기·묶음 ＋ 를 그 칸에서는 내놓지 않는다.
   */
  editLockedColumnKeys?: readonly string[];
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
  /**
   * 상담 단계 보기 — `all` 은 기존 리드컨택 전체 보기(호환 유지).
   * `remote`·`inperson` 은 같은 정본 행을 상담 모드로 가른 STEP2·STEP3 탭이다.
   * 회사·딜·아이템을 복제하지 않고 서버 적재분(`consultationByItem`)으로 가른다.
   */
  consultationView?: ConsultationView;
  /** 152 일괄 조회 적재분 — 행마다 조회하지 않는다. 권한 밖 행은 서버가 이미 뺐다. */
  consultationByItem?: ConsultationBoardMap;
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
  const isNewLeadStageView = canonicalNewLead && columns.some((column) => column.key === "consult_status");
  // 상담 단계 보기 — 같은 리드컨택 정본의 STEP2·STEP3 탭. `all` 은 기존 전체 보기다.
  const isContactBoard = board.source === CONTACT_TAB_SOURCE;
  const isConsultationStageView =
    isContactBoard && (consultationView === "remote" || consultationView === "inperson");
  const showConsultationColumn =
    isContactBoard && (isConsultationStageView || Object.keys(consultationByItem).length > 0);
  const consultationProgressColumn = useMemo<BoardColumn | null>(() => {
    if (!showConsultationColumn) return null;
    return {
      id: `consultation-progress:${board.id}`,
      org_id: board.org_id,
      board_id: board.id,
      key: CONSULTATION_PROGRESS_KEY,
      label: "상담 진행",
      type: "text",
      source: "calc",
      rightPinned: false,
      options_jsonb: null,
      sort_order: Number.MAX_SAFE_INTEGER,
      width: 200,
      // 표시 전용 가상 칸 — 서버 setCells 도 이 키 쓰기를 거부하도록 is_readonly 를 못박는다.
      is_readonly: true,
      move_rule_jsonb: null,
    };
  }, [board.id, board.org_id, showConsultationColumn]);
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
  const tableColumns = useMemo(() => {
    const base = board.source === NEW_LEAD_TAB_SOURCE
      ? activeColumns.filter((column) => !NEW_LEAD_DETAIL_ONLY_KEYS.has(column.key))
      : activeColumns;
    // 상담 진행 가상 칸은 표 맨 끝(우측 고정 관문 바로 앞)에 둔다 — DB 컬럼이 아니라
    // 저장 보기·검색·일괄 대상에 들어가지 않는다.
    if (consultationProgressColumn && !base.some((column) => column.key === CONSULTATION_PROGRESS_KEY)) {
      return [...base, consultationProgressColumn];
    }
    return base;
  }, [activeColumns, board.source, consultationProgressColumn]);
  /*
   * #845 7단계 — 나눠 보기. 기본은 보드별(탭 안의 그룹 = 단계). 사람·목록·상태 칸을 고르면 모든 보드의 행을
   * 그 칸의 값 묶음으로 다시 나눈다. 고른 값은 주소(?group=)에 남고 «저장» 이 뷰에 담는다(보기 조건 groupBy).
   * 바꾸기는 화면 안에서 한다(다시 읽지 않는다). 서버가 새로 그려 주소 값이 바뀌면(뷰 고르기) 그 값을 따른다.
   */
  const [groupBySource, setGroupBySource] = useState(groupBy);
  const [groupByKey, setGroupByKey] = useState(() => (canonicalNewLead && groupBy ? newLeadPresentationKey(groupBy) : groupBy));
  if (groupBySource !== groupBy) {
    setGroupBySource(groupBy);
    setGroupByKey(canonicalNewLead && groupBy ? newLeadPresentationKey(groupBy) : groupBy);
  }
  const groupColumns = useMemo(() => tableColumns.filter((column) => isTableGroupColumn(column)), [tableColumns]);
  const groupColumn = useMemo(
    () => (groupByKey ? groupColumns.find((column) => column.key === groupByKey) ?? null : null),
    [groupColumns, groupByKey],
  );
  const groupByOptions = useMemo(
    () => groupColumns.map((column) => ({ key: column.key, label: columnPlainName(column.label) })),
    [groupColumns],
  );
  const ownerMode = useMemo(() => ownerModeForSource(board.source), [board.source]);
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
    replaceBoardUrl(url);
  }, [filterUrlReady, filters]);
  /*
   * 끌고 있는 행: ref 가 정본(드롭 판정), state 는 표시(반투명·드롭 안내문)용.
   * dragstart 와 drop 사이에 리렌더가 끼지 않아도 드롭이 성립해야 한다.
   */
  const dragRowRef = useRef<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  /*
   * 끄는 동안 빈 그룹을 놓을 자리로 펼치는 표시(#845). dragRowId 와 따로 둔다 — dragstart 에서
   * 행 배치가 움직이면 브라우저가 끌기를 취소하므로, 펼치기는 끌기가 시작된 다음 작업에서 켠다.
   */
  const { revealed: dragRevealGroups, schedule: scheduleDragReveal, cancel: cancelDragReveal } = useDeferredDragReveal();
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

  /*
   * Issue 857 — 셀 저장은 화면 전체를 다시 그리지 않는다.
   *   ① 누른 순간 useOptimistic 으로 그 칸 값을 먼저 그리고 ② 서버가 돌려준 행을 얹어 둔다(cellOverlay).
   *   서버가 화면을 새로 보내면(rows 가 바뀜) 행의 판(updated_at)으로 가린다 — 규칙은 reconcileCellSaveOverlay.
   *   그 행을 같거나 새 판으로 보내면 서버가 이긴다. 저장 «전» 에 출발한 응답(묶음 끌기의 revalidate 등)이
   *   옛 판을 들고 오면 방금 저장한 값을 지운 채 그리지 않는다.
   */
  const [cellOverlay, setCellOverlay] = useState<CellSaveOverlay>(() => ({ rows, saved: {}, messages: {} }));
  if (cellOverlay.rows !== rows) {
    // 화면 데이터가 바뀌었다 — 얹어 둔 것을 새 rows 에 맞춰 가린다(지난 값을 상태로 들고 렌더 중에 비교하는 방식).
    // 함수로 넘긴다 — 아직 처리되지 않은 저장 결과(앞선 갱신)를 덮어쓰지 않고 그 위에서 가린다.
    setCellOverlay((current) => (current.rows === rows ? current : reconcileCellSaveOverlay(current, rows)));
  }
  const latestRowsRef = useRef(rows);
  useEffect(() => {
    latestRowsRef.current = rows;
  }, [rows]);
  const baseRows = useMemo(
    () => applySavedItems(rows, savedItemsAhead(rows, cellOverlay.saved)),
    [rows, cellOverlay.saved],
  );
  const [cellPatchedRows, patchCellOptimistic] = useOptimistic(baseRows, patchCellValue);
  const [optimisticRows, moveRowOptimistic] = useOptimistic(cellPatchedRows, rowMoveReducer);
  /*
   * 저장이 잠시 멈추면(2초) 화면 데이터를 조용히 한 번 새로 받는다. 서버가 계산하는 값(저장된 보기의
   * 담당 범위·건수·행 순서 버전)과 브라우저 뒤로 가기 기억을 맞추려는 것이다. 새로 받는 동안에도
   * 화면은 그대로 보이고, Next 가 액션을 차례로 처리해 그 사이 저장한 값이 되돌아가지 않는다.
   */
  const router = useRouter();
  const quietRefreshTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (quietRefreshTimer.current !== null) window.clearTimeout(quietRefreshTimer.current);
  }, []);
  const scheduleQuietRefresh = useCallback(() => {
    if (quietRefreshTimer.current !== null) window.clearTimeout(quietRefreshTimer.current);
    quietRefreshTimer.current = window.setTimeout(() => {
      quietRefreshTimer.current = null;
      router.refresh();
    }, CELL_SAVE_QUIET_REFRESH_MS);
  }, [router]);
  const saveCell = useCallback(async (formData: FormData) => {
    const itemId = String(formData.get("itemId") ?? "");
    const columnKey = String(formData.get("columnKey") ?? "");
    patchCellOptimistic({ itemId, key: columnKey, value: boardCellValueFromFormData(formData) });
    let result: CellSaveResult;
    try {
      result = await saveCellValueAction(formData);
    } catch {
      result = { ok: false, errors: [{ key: columnKey, label: columnKey, message: "저장하지 못했어요. 잠시 후 다시 시도해 주세요." }] };
    }
    const message = cellSaveMessage(result, columnKey);
    const cellKey = cellMessageKey(itemId, columnKey);
    if (result.ok) {
      const saved = result.item;
      setCellOverlay((prev) => ({
        ...prev,
        saved: { ...prev.saved, [itemId]: { item: saved, staleSeen: 0 } },
        messages: { ...prev.messages, [cellKey]: { message, version: saved.updated_at, failed: false, staleSeen: 0 } },
      }));
      scheduleQuietRefresh();
      return;
    }
    // 실패 사유는 그 칸을 다시 저장하거나 서버가 그 행의 더 새 판을 보낼 때까지 둔다 — 기준은 지금 보던 행의 판.
    const before = latestRowsRef.current.find((row) => row.id === itemId)?.updated_at ?? "";
    setCellOverlay((prev) => ({
      ...prev,
      messages: { ...prev.messages, [cellKey]: { message, version: before, failed: true, staleSeen: 0 } },
    }));
  }, [patchCellOptimistic, scheduleQuietRefresh]);
  const cellSaveApi = useMemo<CellSaveApi>(() => ({
    save: saveCell,
    messageFor: (itemId, columnKey) => cellOverlay.messages[cellMessageKey(itemId, columnKey)]?.message,
  }), [cellOverlay.messages, saveCell]);
  const displayRows = useMemo(() => {
    // 상담 단계 보기 — 같은 정본 행을 서버 적재분의 mode 로 가른다. 적재된 레거시 remote 는
    // SQL 의도된 기본값이며, 미조회(null)는 특정 보기에 넣지 않는다(F5). 새로고침해도 mode 는 DB 값 그대로다.
    const scoped = isConsultationStageView
      ? optimisticRows.filter((row) => consultationModeForRow(row.id, consultationByItem) === consultationView)
      : optimisticRows;
    return workflowProgressKind
      ? withWorkflowProgressValues(workflowProgressKind, scoped)
      : scoped;
  }, [consultationByItem, consultationView, isConsultationStageView, optimisticRows, workflowProgressKind]);
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
  const [bulkNotice, setBulkNotice] = useState<ResultNotice | null>(null);
  // 상담 단계 보기 전환 시에도 선택을 비운다 — 다른 탭의 선택이 섞이지 않게 한다.
  const [selectionScope, setSelectionScope] = useState(() => selectionScopeKey(board.id, `${savedViewId ?? savedViewActive}|${consultationView}`));
  const currentSelectionScope = selectionScopeKey(board.id, `${savedViewId ?? savedViewActive}|${consultationView}`);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  /**
   * 2026-10-08 대표 결정 — 「업체 추가」 는 머리말의 주 단추 하나 + 배너 ＋ 로만 연다.
   * 누를 때마다 seq 가 올라 그 그룹의 추가 패널이 열린다(이미 열려 있으면 그대로).
   */
  const [addRequest, setAddRequest] = useState<{ key: string; seq: number } | null>(null);
  // 패널을 닫으면 포커스를 그 패널을 연 단추로 돌린다(그룹마다의 「＋ 업체 추가」 단추가 이제 없다).
  // 그룹마다 따로 기억한다 — A 를 열고 B 를 연 뒤 A 를 닫아도 A 를 연 단추로 돌아간다.
  const addOpenersRef = useRef(new Map<string, HTMLElement | null>());
  /** 지금 접혀 있는 빈 블록의 키 — 추가 요청이 그 블록을 가리키면 먼저 펼친다. */
  const foldedBlockKeysRef = useRef<ReadonlySet<string>>(new Set());
  const requestAdd = (blockKey: string, opener: HTMLElement | null) => {
    addOpenersRef.current.set(blockKey, opener);
    setClosedGroups((current) => {
      if (!current.has(blockKey)) return current;
      const next = new Set(current);
      next.delete(blockKey);
      return next;
    });
    const bump = () => setAddRequest((current) => ({ key: blockKey, seq: (current?.seq ?? 0) + 1 }));
    // 접혀 있는 빈 블록(나눠 보기의 「(없음)」 등)에 추가하려면 먼저 펼친다. 추가 패널은 «값이 바뀔 때» 열리므로
    // 펼친 블록이 그려진 다음에 요청을 올린다.
    if (foldedBlockKeysRef.current.has(blockKey)) {
      setEmptyGroupsOpen(true);
      window.setTimeout(bump, 0);
      return;
    }
    bump();
  };
  /*
   * #845 (대표 지시 2026-10-06, 승인 방향 목업 Main.dc) — 보이는 행이 0건인 그룹은 끝의 컨트롤
   * 하나(«빈 보드 N개 보기»)로 접는다. 펼치면 제자리 순서로 다시 나오고, 행을 끄는 동안에는
   * 놓을 자리로 모두 나온다. 이 세션에 새로 생긴 그룹은 접지 않는다(만들자마자 사라지지 않게).
   */
  const [emptyGroupsOpen, setEmptyGroupsOpen] = useState(false);
  const [sessionGroupBaseline, setSessionGroupBaseline] = useState(() => ({
    boardId: board.id,
    ids: new Set(groups.map((group) => group.id)),
  }));
  if (sessionGroupBaseline.boardId !== board.id) {
    setSessionGroupBaseline({ boardId: board.id, ids: new Set(groups.map((group) => group.id)) });
  }
  if (selectionScope !== currentSelectionScope) {
    setSelectionScope(currentSelectionScope);
    setSelectedIds(new Set());
    setBulkDialog(null);
    setBulkNotice(null);
    setEmptyGroupsOpen(false);
  }
  // Shift-범위 기준점 — 보이는 순서에서의 마지막 토글 위치.
  const lastToggledRef = useRef<string | null>(null);

  const readOnly = board.is_system || !canEditItems;
  const sortActive = filters.sortKey !== "" || (filters.sorts?.length ?? 0) > 0;
  // 상담 단계 보기는 가상 계약 단계 묶음이라 행 순서를 옮기지 않는다 —
  // 순서는 리드컨택 전체 보기(물리 그룹)에서만 바꾼다.
  const rowDragEnabled = !readOnly && canMoveRows && !sortActive && !rowMovePending && !isConsultationStageView;
  /*
   * #845 7단계 — 나눠 보기에서 끌기는 «값 바꾸기» 다. 행 순서 권한(canMoveRows)이 아니라 항목 수정 권한과
   * 그 칸을 이 길로 바꿀 수 있는지(groupValueEditBlock — 고칠 수 없는 칸·편집 제한 칸·✉ 발송 칸·신규리드 정본·배정 담당)로 정한다.
   * 줄 세우기와는 상관없다(순서를 저장하지 않는다). 서버(setGroupValueAction)가 같은 규칙으로 다시 막는다.
   */
  const groupValueBlocked = groupColumn
    ? groupValueEditBlock(groupColumn, {
      canonicalNewLead,
      ownerMode,
      editPolicyAllows: !editLockedColumnKeys.includes(groupColumn.key),
    })
    : null;
  const groupValueEditable = Boolean(groupColumn) && !readOnly && groupValueBlocked === null;
  const groupValueInFlightRef = useRef(false);
  const [groupValuePending, setGroupValuePending] = useState(false);
  const [groupValueNotice, setGroupValueNotice] = useState<ResultNotice | null>(null);

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
  // 접힌 빈 그룹(#845)은 화면에 없으므로 ↑/↓ 는 그것을 건너뛰어 «보이는» 이웃과 자리를 바꾼다.
  const foldedGroupIdsRef = useRef<ReadonlySet<string>>(new Set());
  const moveGroup = useCallback((groupId: string, delta: number) => {
    const from = orderedGroups.findIndex((group) => group.id === groupId);
    let to = from + delta;
    while (to >= 0 && to < orderedGroups.length && foldedGroupIdsRef.current.has(orderedGroups[to].id)) to += delta;
    if (from < 0 || to < 0 || to >= orderedGroups.length || from === to) return;
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

  const physicalBlocks = useMemo(
    () => buildBlocks(orderedGroups, displayRows),
    [orderedGroups, displayRows],
  );
  /**
   * 상담 단계 보기의 계약 단계 묶음 — 비대면·대면 «각각» 의 계약 단계 보드다.
   * 같은 정본 행을 계약 단계 키(1단계 계약금 → 2단계 직인 → 완료)로 묶는 가상 묶음이라 회사·딜·아이템을
   * 복제하지 않고, 물리 그룹·순서·이동 규칙을 건드리지 않는다.
   */
  const consultationStageBlocks = useMemo<ReturnType<typeof buildBlocks> | null>(() => {
    if (!isConsultationStageView) return null;
    const buckets = new Map<string, ItemWithValues[]>();
    for (const row of displayRows) {
      const entry = consultationByItem[row.id];
      if (!entry) continue;
      const phase = consultationPhase(entry);
      // ★ 167: 계약 진행은 1단계(계약금) → 2단계(직인) → 완료. 계약금 칸을 바꾸면 바로 옮겨간다.
      const key = phase === "contract" ? contractStepGroupKey(withRowContractFee(entry, row.values)) : phase;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(row);
      else buckets.set(key, [row]);
    }
    const phaseGroups = (consultationView === "inperson" ? INPERSON_PHASES : REMOTE_PHASES)
      .filter((phase) => phase !== "contract").map((phase) => ({ key: phase, title: CONSULTATION_PHASE_LABEL[phase] }));
    return [...phaseGroups, ...CONTRACT_STEP_GROUPS].map((group) => {
      const rows = [...(buckets.get(group.key) ?? [])].sort((a, b) => a.sort_order - b.sort_order);
      return {
        kind: "item-group" as const,
        key: `consult-step:${group.key}`,
        group: null,
        name: `${group.title} (${rows.length})`,
        color: null,
        rows,
      };
    });
  }, [consultationByItem, consultationView, displayRows, isConsultationStageView]);
  const newLeadStageBlocks = useMemo(() => isNewLeadStageView ? buildNewLeadStageBlocks(orderedGroups, displayRows) : null,
    [isNewLeadStageView, orderedGroups, displayRows]);
  // 사람 칸 묶음의 순서 = 구성원 순서(사람 선택기·담당자 탭과 같은 원천).
  const groupMembers = useMemo(
    () => memberDirectory?.length
      ? memberDirectory.map((member) => ({ id: member.id, label: member.label }))
      : Object.entries(assigneeLabels).map(([id, label]) => ({ id, label: label || "이름 없는 구성원" })),
    [assigneeLabels, memberDirectory],
  );
  /** #845 7단계 — 나눠 보기 묶음. 보드별(기본)이면 null 이고 아래 보드·단계 블록을 그대로 쓴다. */
  const valueBlocks = useMemo(
    () => groupColumn
      ? buildValueBlocks({ column: groupColumn, groups: orderedGroups, rows: displayRows, members: groupMembers, memberLabels: assigneeLabels, ownerMode })
      : null,
    [assigneeLabels, displayRows, groupColumn, groupMembers, orderedGroups, ownerMode],
  );
  const valueMode = valueBlocks !== null;
  const blocks = valueBlocks ?? consultationStageBlocks ?? newLeadStageBlocks ?? physicalBlocks;
  const firstGroupId = orderedGroups[0]?.id ?? null;
  // 그룹마다 «패널을 연 단추로 포커스 돌리기» 함수 — 그룹 구성이 그대로면 같은 함수라 접수 폼의 효과가 다시 돌지 않는다.
  const blockKeysSignature = JSON.stringify(blocks.map((block) => block.key));
  const addReturnFocusByKey = useMemo(
    () => new Map((JSON.parse(blockKeysSignature) as string[]).map((key) => [key, () => addOpenersRef.current.get(key) ?? null] as const)),
    [blockKeysSignature],
  );
  const addReturnFocusFor = (key: string) => addReturnFocusByKey.get(key);
  const durableLayoutKey = useCallback((key: string) => {
    // 값 묶음은 보드가 아니다 — 칸 순서는 보드 전체의 것이라 첫 보드의 배치를 함께 쓴다(제목행 하나).
    if (valueMode) return firstGroupId ?? UNGROUPED_KEY;
    const block = isNewLeadStageView ? blocks.find((candidate) => candidate.key === key) : undefined;
    return block ? durableNewLeadBlockKey(block, orderedGroups) : key;
  }, [blocks, firstGroupId, isNewLeadStageView, orderedGroups, valueMode]);

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
      ? presentNewLeadColumnKeys(optimisticOrder[durableLayoutKey(blockKey)])
      : optimisticOrder[durableLayoutKey(blockKey)];
    const resolved = resolveColumnOrder(tableColumns, storedOrder ?? undefined);
    return selectVisibleColumns(resolved, displayFilters.visibleColumnKeys);
  }, [canonicalNewLead, displayFilters.visibleColumnKeys, optimisticOrder, tableColumns, durableLayoutKey]);

  /**
   * 검색 기준 컬럼 — 인가된 전체 active 컬럼 (보기에서 숨긴 칸 포함).
   * columnsForBlock(표시 전용)으로 검색하면 숨긴 칸의 텍스트·라벨·전화가 새지 않는다.
   * 서버가 이미 권한 밖 행을 빼고 준 rows만 대상으로 삼으므로 여기서
   * 허가받지 않은 데이터를 새로 조회하지는 않는다. +82 정규화는 filters가 유지한다.
   */
  const searchColumns = useMemo(() => {
    const ordered = canonicalNewLead ? presentNewLeadColumns(activeSummaryColumns) : activeSummaryColumns;
    return workflowProgressKind ? presentWorkflowProgressColumns(workflowProgressKind, ordered) : ordered;
  }, [activeSummaryColumns, canonicalNewLead, workflowProgressKind]);

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

  /**
   * 2026-10-06 (#839) — 계약업체 실무 한정: 보드에 «보이는» 행 중 같은 제목(=회사명) 수.
   * 2건 이상이면 제목 옆에 «같은 회사 N건» 을 단다. 필터로 숨긴 행은 세지 않고(보이는 것과
   * 같은 답), 접힌 그룹의 행은 보드 위에 있으므로 센다. 표시 전용 — 제목·데이터는 그대로다.
   */
  const sameTitleCounts = useMemo(() => {
    if (workflowProgressKind !== "work") return undefined;
    const counts = new Map<string, number>();
    for (const block of blocks) {
      for (const row of applyFilters(block.rows, searchColumns, displayFilters, filterProjection, assigneeLabels)) {
        counts.set(row.title, (counts.get(row.title) ?? 0) + 1);
      }
    }
    return counts;
  }, [assigneeLabels, blocks, displayFilters, filterProjection, searchColumns, workflowProgressKind]);

  /**
   * #845 (대표 지시 2026-10-06) — 그룹 톤: 탭의 메인 2색 × 깊이. 블록 키별로 한 번 정하고
   * 그룹 띠·행 첫 칸 줄·진행현황 선택지 점이 모두 같은 톤을 쓴다(단계 색 = 그룹 띠 색).
   * «그룹 없음» 묶음은 톤이 없다(중립색).
   */
  const groupTones = useMemo(() => {
    // 단계 = 그룹으로 연결된 탭(계약업체 실무)은 그룹마다 이동 규칙이 가리키는 대표 단계 id 로
    // 톤을 정한다 — 띠 이름을 바꿔도 깊이가 유지된다(#845 단계-그룹 연동).
    const stageColumn = workflowProgressKind === "work"
      ? physicalActiveColumns.find((column) => column.key === "progress_status") ?? null
      : null;
    const stageByGroup = new Map<string, string>();
    if (stageColumn) {
      for (const group of orderedGroups) {
        const stage = primaryStageForGroup(stageColumn, orderedGroups, group.id);
        if (stage) stageByGroup.set(group.id, stage);
      }
    }
    // 나눠 보기 묶음은 톤이 없다(선택지 색·중립색) — 진행현황 점의 톤은 실제 보드로 정한다.
    const toneBlocks = valueMode ? physicalBlocks : blocks;
    return resolveGroupTones(
      board.source,
      toneBlocks.filter((block) => block.key !== UNGROUPED_KEY).map((block) => ({ key: block.key, name: block.name })),
      stageByGroup,
    );
  }, [blocks, board.source, orderedGroups, physicalActiveColumns, physicalBlocks, valueMode, workflowProgressKind]);

  /**
   * 진행현황 선택지 중 «행을 옮기는» 것 → 목표 그룹 (#839). 화면용 진행현황 열은 이동 규칙을
   * 비우므로 원본 단계 컬럼에서 읽는다. 단계별 가상 묶음(신규리드 단계 보기·상담 단계 보기)은
   * 물리 그룹을 보여 주지 않으므로 나누지 않는다. 목표 그룹의 톤(accent)을 함께 실어 선택지
   * 점이 그 그룹 띠와 같은 색이 되게 한다(#845). 보드에 없는 그룹을 가리키는 규칙은 뺀다.
   */
  const workflowMoveTargets = useMemo(() => {
    if (!workflowProgressKind || isNewLeadStageView || isConsultationStageView) return null;
    const toned = orderedGroups.map((group) => {
      const tone = groupTones.get(group.id);
      return { id: group.id, name: group.name, accent: tone ? groupToneAccent(tone) : null };
    });
    return workflowStageMoveTargets(workflowProgressKind, physicalActiveColumns, toned);
  }, [groupTones, isConsultationStageView, isNewLeadStageView, orderedGroups, physicalActiveColumns, workflowProgressKind]);

  /** 그룹 이름의 표시 전용 정리(앞머리 이모지) — 이모지만 다른 이름끼리는 원문을 지킨다. */
  const blockDisplayNames = useMemo(() => {
    const shown = presentLabels(blocks.map((block) => block.name));
    return new Map(blocks.map((block, index) => [block.key, shown[index]]));
  }, [blocks]);
  const groupMoveOptions = useMemo(() => {
    const shown = presentLabels(orderedGroups.map((group) => group.name));
    return orderedGroups.map((group, index) => ({ id: group.id, name: shown[index] }));
  }, [orderedGroups]);
  /** 나눠 보기의 키보드 「묶음으로 이동」 선택지 — 묶음 키와 이름. */
  const valueMoveOptions = useMemo(
    () => valueMode ? blocks.map((block) => ({ id: block.key, name: blockDisplayNames.get(block.key) ?? block.name })) : [],
    [blockDisplayNames, blocks, valueMode],
  );

  const bulkTargetIds = useMemo(
    () => intersectVisibleSelection(selectedIds, visibleOrderedIds),
    [selectedIds, visibleOrderedIds],
  );
  const rowById = useMemo(() => new Map(displayRows.map((row) => [row.id, row])), [displayRows]);
  const bulkTargets = useMemo(
    () => bulkTargetIds.map((id) => ({ id, title: rowById.get(id)?.title ?? id, updatedAt: rowById.get(id)?.updated_at ?? null, parentItemId: rowById.get(id)?.parent_item_id ?? null })),
    [bulkTargetIds, rowById],
  );
  /** 상하위 연결 후보 — 보기 내 전체 행 (접힌 그룹·검색제외는 visibleOrderedIds에서 이미 빠진다). */
  const linkCandidates = useMemo(
    () => visibleOrderedIds.map((id) => ({ id, title: rowById.get(id)?.title ?? id })),
    [visibleOrderedIds, rowById],
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
  const bulkStatusColumn = useMemo(() => {
    const picked = pickBulkStatusColumn(canonicalNewLead ? presentNewLeadColumns(physicalActiveColumns) : physicalActiveColumns, workflowProgressKind);
    if (!picked) return null;
    // ★ 일괄 만들기 입구 — 실제 컬럼 id + 시스템보드 제외 + 관리 권한 + 저장 액션 +
    //   순수 가드 통과가 «다» 있을 때만 열린다. 하나라도 없으면 검색 전용이다.
    //   워크플로 단계·지역·연동 컬럼은 여기서 행 자체가 안 보인다(서버도 다시 막는다).
    const pickedColumn = physicalActiveColumns.find((candidate) => candidate.key === picked.key);
    const guardAllowsCreate = pickedColumn
      ? canCreateLabelForColumn(pickedColumn).allowed
      : false;
    const canCreateBulkLabel =
      !board.is_system && canManageColumns === true && typeof addLabelOptionAction === "function"
      && guardAllowsCreate;
    return {
      ...picked,
      canCreate: canCreateBulkLabel,
      onCreateLabel: canCreateBulkLabel && picked.columnId
        ? (label: string) => addLabelOptionAction!({
            boardId: board.id,
            columnId: picked.columnId!,
            label,
            requestId: newLabelRequestId(),
          })
        : undefined,
    };
  }, [canonicalNewLead, physicalActiveColumns, workflowProgressKind, board.id, board.is_system, canManageColumns, addLabelOptionAction]);
  const bulkFieldColumns = useMemo(
    () => tableColumns
      .filter((column) =>
        BULK_FIELD_TYPES.has(column.type)
        && isSourceEditable(column.source)
        && column.is_readonly !== true
        && !BULK_BLOCKED_COLUMN_KEYS.has(column.key)
        && column.key !== WORKFLOW_PROGRESS_KEY
        && column.key !== CONSULTATION_PROGRESS_KEY)
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
    // 상담 진행 가상 칸은 표시 전용이라 내보내기에 넣지 않는다.
    const exportColumns = tableColumns.filter((column) =>
      column.key !== CONSULTATION_PROGRESS_KEY
      && (visibleKeys === null || visibleKeys.includes(column.key)));
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
    startNewCompanyWorkAction,
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

  /*
   * #845 5단계 — 칸 메뉴 「보기 · 나만」 의 요청을 받는 곳(onRequestViewCondition). 보기 줄과 같은 보기 조건
   * (주소에 남고 «저장» 이 담는다)을 바꾼다 — 그래서 뷰가 «바뀜» 이 된다. 칸 순서처럼 모두에게 바뀌는 것은 여기서 다루지 않는다.
   *   · sort   — 이 칸 하나로 줄 세운다(다른 줄 세우기는 걷는다) · null 이면 이 칸만 뺀다
   *   · filter — 「골라 보기…」: 보기 조건 칸을 골라 보기 탭으로 펴고 그 칸 칩을 연다(6단계)
   *   · hide   — 「숨기기」: 보이는 칸에서 뺀다
   * 보기 줄과 똑같이 화면 key(displayFilters) 기준으로 고친다 — 신규리드 durable/present key 변환은 그대로 돈다.
   */
  const [filterFocus, setFilterFocus] = useState<ToolbarFilterFocus | null>(null);
  /** 나눠 보기 바꾸기(보기 줄 · 칸 메뉴) — 화면 안에서 묶음을 바꾸고 주소의 group 만 고친다. */
  const changeGroupBy = useCallback((key: string) => {
    setGroupByKey(key);
    setEmptyGroupsOpen(false);
    setGroupValueNotice(null);
    const url = new URL(window.location.href);
    const stored = key && canonicalNewLead ? durableNewLeadColumnKeys([key])[0] ?? key : key;
    if (stored) url.searchParams.set("group", stored);
    else url.searchParams.delete("group");
    replaceBoardUrl(url);
  }, [canonicalNewLead]);
  const tableColumnKeys = tableColumns.map((column) => column.key).join(",");
  const onRequestViewCondition = useCallback((request: ColumnViewRequest) => {
    if (request.kind === "filter") {
      setFilterFocus((current) => ({ columnKey: request.columnKey, seq: (current?.seq ?? 0) + 1 }));
      return;
    }
    if (request.kind === "group") {
      changeGroupBy(request.on ? request.columnKey : "");
      return;
    }
    setFilters((current) => {
      const shown = canonicalNewLead ? presentNewLeadSavedFilters(current) : current;
      if (request.kind === "sort") {
        const sorts = shown.sorts?.length
          ? shown.sorts
          : shown.sortKey
            ? [{ columnKey: shown.sortKey, direction: shown.sortDir }]
            : [];
        return {
          ...shown,
          sortKey: "",
          sortDir: "asc",
          sorts: request.direction
            ? [{ columnKey: request.columnKey, direction: request.direction }]
            : sorts.filter((sort) => sort.columnKey !== request.columnKey),
        };
      }
      const allKeys = tableColumnKeys ? tableColumnKeys.split(",") : [];
      const visible = shown.visibleColumnKeys ?? allKeys;
      return { ...shown, columnLimit: 0, visibleColumnKeys: visible.filter((key) => key !== request.columnKey) };
    });
  }, [canonicalNewLead, changeGroupBy, tableColumnKeys]);
  const canFilterColumn = useCallback((column: BoardColumn) => hasToolbarFacet(column), []);
  const canGroupColumn = useCallback((column: BoardColumn) => isTableGroupColumn(column), []);
  const activeSorts = displayFilters.sorts?.length
    ? displayFilters.sorts
    : displayFilters.sortKey
      ? [{ columnKey: displayFilters.sortKey, direction: displayFilters.sortDir }]
      : [];

  const handleColumnDrop = (
    groupKey: string,
    /** 그 그룹의 **전체** 컬럼 순서(컬럼수 제한 적용 전). */
    fullColumns: BoardColumn[],
    draggedKey: string,
    targetKey: string,
  ) => {
    groupKey = durableLayoutKey(groupKey);
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
    groupKey=durableLayoutKey(groupKey);
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
   * 2026-10-08 대표 결정 — 제목행이 보드 맨 위 하나일 때, 거기서 컬럼을 옮기면 모든 그룹(접힌 빈
   * 보드 포함)에 같은 이동을 적용한다. 그룹마다 저장된 배치가 달라도 «같은 컬럼을 같은 자리로»
   * 옮기므로 보이는 순서는 하나로 남는다. 저장은 한 번에(setGroupColumnOrdersAction).
   */
  // 저장할 수 있는 키는 실제 그룹 id 와 «그룹 없음» 뿐이다. 상담 단계 보기처럼 가상 묶음만 있는
  // 화면에서는 맨 위 제목행의 컬럼 옮기기를 끈다(저장할 곳이 없어 늘 실패하던 동작).
  const durableGroupKeys = new Set([UNGROUPED_KEY, ...orderedGroups.map((group) => group.id)]);
  const sharedColumnsMovable = blocks.length > 0
    && blocks.every((block) => durableGroupKeys.has(durableLayoutKey(block.key)));
  const applySharedColumnMove = (move: (fullColumns: BoardColumn[]) => string[] | null) => {
    if (!sharedColumnsMovable) return;
    const entries = new Map<string, string[]>();
    // 지금 보이는 묶음만이 아니라 «모든» 실제 그룹과 «그룹 없음» 을 맞춘다 — 행이 없어 묶음이 안 보이던
    // 그룹(신규리드 단계 보기의 빈 단계 등)도 같은 순서여야 나중에 행이 들어와도 제목행이 갈라지지 않는다.
    const groupKeys = new Set([
      ...orderedGroups.map((group) => group.id),
      UNGROUPED_KEY,
      ...blocks.map((block) => durableLayoutKey(block.key)),
    ]);
    for (const groupKey of groupKeys) {
      if (!durableGroupKeys.has(groupKey)) continue;
      const storedOrder = canonicalNewLead
        ? presentNewLeadColumnKeys(optimisticOrder[groupKey])
        : optimisticOrder[groupKey];
      const keys = move(resolveColumnOrder(tableColumns, storedOrder ?? undefined));
      if (keys) entries.set(groupKey, keys);
    }
    if (entries.size === 0) return;
    startTransition(async () => {
      for (const [groupKey, keys] of entries) setOrderOptimistic({ groupKey, keys });
      const fd = new FormData();
      fd.set("boardId", board.id);
      fd.set("entries", JSON.stringify([...entries].map(([groupKey, keys]) => ({
        groupKey,
        order: canonicalNewLead ? durableNewLeadColumnKeys(keys) : keys,
      }))));
      await setGroupColumnOrdersAction(fd);
    });
  };
  const handleSharedColumnDrop = (draggedKey: string, targetKey: string) =>
    applySharedColumnMove((fullColumns) => reorderColumnKeys(fullColumns, draggedKey, targetKey));
  // 키보드 ±1 은 «보이는» 이웃 칸 자리로 옮긴다(끌어 놓기와 같은 규칙). 숨긴 칸까지 센 전체 순서로
  // 한 칸씩 밀면, 숨긴 칸 위치가 그룹마다 다를 때 보이는 순서가 갈라진다.
  const handleSharedColumnKeyboardMove = (columnKey: string, delta: number) => {
    const visible = blocks[0] ? columnsForBlock(blocks[0].key).map((column) => column.key) : [];
    const from = visible.indexOf(columnKey);
    const target = from < 0 ? undefined : visible[from + delta];
    if (!target) return;
    handleSharedColumnDrop(columnKey, target);
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

  // dragstart 안에서는 행 배치를 바꾸지 않는다 — 반투명·안내문만 바꾸고, 빈 그룹 펼치기는 예약한다.
  const startRowDrag = useCallback((itemId: string) => {
    dragRowRef.current = itemId;
    setDragRowId(itemId);
    setMoveNotice("이동할 위치를 선택하세요.");
    scheduleDragReveal();
  }, [scheduleDragReveal]);

  const endRowDrag = useCallback(() => {
    dragRowRef.current = null;
    setDragRowId(null);
    cancelDragReveal();
  }, [cancelDragReveal]);

  const canDropRow = useCallback(
    () => rowDragEnabled && dragRowRef.current !== null,
    [rowDragEnabled],
  );
  // 나눠 보기: 끌기가 켜져 있고, 끄는 행이 지금 묶음의 것이 아닐 때만 놓을 수 있다(같은 묶음 안 순서는 저장하지 않는다).
  const valueDragEnabled = groupValueEditable && !groupValuePending;
  const valueSectionByRow = useMemo(
    () => valueMode ? new Map(blocks.flatMap((block) => block.rows.map((row) => [row.id, block.key] as const))) : null,
    [blocks, valueMode],
  );
  const canDropInto = (blockKey: string) => valueMode
    ? () => valueDragEnabled && dragRowRef.current !== null && valueSectionByRow?.get(dragRowRef.current) !== blockKey
    : canDropRow;

  const groupValueForm = (itemId: string, columnKey: string, value: CellValue) => {
    const fd = new FormData();
    fd.set("boardId", board.id);
    fd.set("itemId", itemId);
    fd.set("columnKey", columnKey);
    fd.set("value", JSON.stringify(value));
    return fd;
  };
  /** 행을 다른 묶음으로 — 먼저 옮겨 보이고(낙관적), 서버가 거절하면 제자리로 돌아가며 까닭을 보인다. */
  const persistGroupValue = (row: ItemWithValues, target: BoardBlock) => {
    if (!groupColumn || !target.groupValue) return;
    if (groupValueInFlightRef.current) { setMoveNotice("이전 변경을 저장하고 있어요."); return; }
    groupValueInFlightRef.current = true;
    setGroupValuePending(true);
    setGroupValueNotice(null);
    const columnKey = groupColumn.key;
    const value = movedGroupValue(groupColumn, row.values[columnKey] ?? null, target.groupValue.id);
    const targetName = blockDisplayNames.get(target.key) ?? target.name;
    startTransition(async () => {
      moveRowOptimistic({ itemId: row.id, columnKey, value });
      try {
        const result = await setGroupValueAction(groupValueForm(row.id, columnKey, value));
        if (result.ok) setMoveNotice(result.notice ?? `「${targetName}」에 옮겼어요.`);
        else { setMoveNotice(result.message); setGroupValueNotice({ ok: false, message: result.message }); }
      } catch {
        const message = "값을 바꾸지 못했어요. 다시 시도해 주세요.";
        setMoveNotice(message);
        setGroupValueNotice({ ok: false, message });
      } finally {
        groupValueInFlightRef.current = false;
        setGroupValuePending(false);
      }
    });
  };
  const handleValueDrop = (target: BoardBlock) => {
    const itemId = dragRowRef.current;
    endRowDrag();
    if (!itemId || !valueDragEnabled) return;
    if (valueSectionByRow?.get(itemId) === target.key) { setMoveNotice("같은 묶음 안에서는 순서를 바꾸지 않아요."); return; }
    const row = rowById.get(itemId);
    if (row) persistGroupValue(row, target);
  };
  const moveRowToValueSection = (rowId: string, targetKey: string | null) => {
    const target = blocks.find((block) => block.key === targetKey);
    const row = rowById.get(rowId);
    if (!target || !row || !valueDragEnabled) return;
    if (valueSectionByRow?.get(rowId) === target.key) { setMoveNotice("이미 이 묶음에 있어요."); return; }
    persistGroupValue(row, target);
  };
  /** 회사부터 고르는 추가(계약업체 실무)는 만든 뒤에 묶음 값을 넣는다 — 같은 값 바꾸기 길(권한 확인 포함). */
  const applyCreatedPrefill = (itemId: string, prefill: { columnKey: string; value: CellValue }) => {
    startTransition(async () => {
      try {
        const result = await setGroupValueAction(groupValueForm(itemId, prefill.columnKey, prefill.value));
        if (!result.ok) setGroupValueNotice({ ok: false, message: result.message });
      } catch {
        setGroupValueNotice({ ok: false, message: "묶음 값을 넣지 못했어요. 칸에서 골라 주세요." });
      }
    });
  };

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
    if(!rowDragEnabled){setMoveNotice(rowMoveInFlightRef.current?"이전 이동을 저장하고 있어요.":sortActive?"줄 세우기 중에는 행 순서를 바꿀 수 없어요.":"행을 옮길 권한이 없어요.");return;}
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

  /*
   * 블록별 «보이는 행» 과 빈 그룹 접기(#845). 접는 것은 화면 배치뿐이다 — 그룹·행·순서·합계는
   * 그대로다. 접지 않는 것:
   *   · 첫 블록 — 새 행이 들어오는 자리(start_company_work 의 첫 그룹)라 늘 보인다.
   *   · 이 세션에 새로 생긴 그룹 — 만들자마자 사라지지 않게(이름 바꾸기·행 추가가 바로 된다).
   *   · 가상 단계 묶음(상담 단계 보기·신규리드 단계 보기) — 고정 단계표라 «(0)» 도 정보다.
   */
  const blockViews = blocks.map((block, index) => {
    // 검색(q)은 인가된 전체 active 컬럼을 대상으로 삼는다 — UI 열 숨김은 권한 숨김이 아니다.
    const visibleRows = applyFilters(block.rows, searchColumns, displayFilters, filterProjection, assigneeLabels);
    const createdThisSession = Boolean(block.group && !sessionGroupBaseline.ids.has(block.group.id));
    // 계약업체 실무 보드에서만, 실제로 행이 0건인 그룹만 접는다(검색·필터로 0건이 된 그룹은 접지 않는다).
    // 나눠 보기는 모든 보드에서 빈 묶음(행 0건인 값)을 접는다 — 끄는 동안에는 놓을 자리로 나온다.
    const foldable = valueMode
      ? block.rows.length === 0
      : workflowProgressKind === "work" && index > 0 && block.group !== null
        && block.rows.length === 0 && !createdThisSession;
    return { block, visibleRows, foldable };
  });
  const foldedEmptyCount = blockViews.filter((view) => view.foldable).length;
  const foldedGroupIdsKey = emptyGroupsOpen
    ? ""
    : blockViews.filter((view) => view.foldable && view.block.group).map((view) => view.block.group!.id).join(",");
  useEffect(() => {
    foldedGroupIdsRef.current = new Set(foldedGroupIdsKey ? foldedGroupIdsKey.split(",") : []);
  }, [foldedGroupIdsKey]);
  const foldedBlockKeysKey = emptyGroupsOpen
    ? ""
    : JSON.stringify(blockViews.filter((view) => view.foldable).map((view) => view.block.key));
  useEffect(() => {
    foldedBlockKeysRef.current = new Set(foldedBlockKeysKey ? JSON.parse(foldedBlockKeysKey) as string[] : []);
  }, [foldedBlockKeysKey]);
  // 행을 끄는 동안에는 빈 그룹도 놓을 자리로 보여 준다 — 끌기가 시작된 뒤에(useDeferredDragReveal).
  const shownBlockViews = emptyGroupsOpen || dragRevealGroups
    ? blockViews
    : blockViews.filter((view) => !view.foldable);
  /*
   * 2026-10-08 대표 결정 — 제목행은 보드 맨 위 하나, 내려가도 따라온다(아사나·노션 방식).
   * 보이는 그룹의 열 구성이 모두 같을 때만 하나로 합친다. 어떤 그룹이 따로 열 순서를 바꿔
   * 구성이 다르면 그 차이를 숨기지 않도록 지금처럼 그룹마다 제목행을 그린다(데이터는 그대로).
   */
  // 판단은 행을 끄는 동안 잠깐 펼쳐지는 빈 보드를 빼고 한다 — 끌기 도중에 제목행 방식이 바뀌어 표가
  // 다시 배치되지 않게. 그때 펼쳐진 보드의 열 구성이 다르면 그 보드만 자기 제목행을 그린다.
  const signatureOf = (blockKey: string) => columnsForBlock(blockKey).map((column) => column.key).join(",");
  const stableBlockViews = emptyGroupsOpen ? blockViews : blockViews.filter((view) => !view.foldable);
  const sharedSignature = stableBlockViews.length > 0 ? signatureOf(stableBlockViews[0].block.key) : null;
  const sharedHeader = sharedSignature !== null
    && stableBlockViews.every(({ block }) => signatureOf(block.key) === sharedSignature);
  const sharedBlockKeys = new Set(sharedHeader
    ? shownBlockViews.filter(({ block }) => signatureOf(block.key) === sharedSignature).map(({ block }) => block.key)
    : []);
  const sharedHeaderRows = shownBlockViews.filter((view) => sharedBlockKeys.has(view.block.key)).flatMap((view) => view.visibleRows);
  // 「업체 추가」 를 머리말 단추·배너 ＋ 로만 여는 보드 — 회사를 먼저 고르는 계약업체 실무.
  const onDemandAdd = Boolean(companyPickerProps.companyPicker) && !readOnly;

  return (
    /*
     * 원칙 2·8 — 인위적 max-width 없이 뷰포트 폭을 그대로 쓴다.
     * 세로 여백(gap-3)은 "그룹 사이 구획"이라는 위계 표현으로만 쓴다(원칙 10).
     * 탭 설정·휴지통 확인은 머리말이 열고 화면이 넘긴 슬롯이 그린다(#845 — 열림 상태는 제공자가 든다).
     */
    <CellSaveContext.Provider value={cellAction ? null : cellSaveApi}>
    <TabChromeProvider
      settings={tabSettingsSlot}
      settingsSections={board.is_system ? [] : tabSettingsSections}
      trash={board.is_system ? undefined : tabTrashSlot}
    >
    <div data-board-workspace="" className="flex w-full min-w-0 max-w-full flex-col gap-3 overflow-x-hidden">
      <BoardHeader
        boardId={board.id}
        icon={board.icon}
        name={board.name}
        description={board.description}
        groups={groups}
        readOnly={readOnly}
        canEditTitle={!board.is_system&&canManageSummaries}
        source={board.source}
        backSlot={backSlot}
        helpSlot={onboardingSlot}
        addItemSlot={onDemandAdd && blocks[0] ? (
          /*
           * 2026-10-08 — 계약업체 실무의 주 단추. 이름만 받는 「＋ 새 항목」 대신 회사부터 고르는 첫 보드의 추가 패널을 연다.
           * 나눠 보기 중이면 값을 미리 넣지 않는 「(없음)」 묶음의 패널을 연다(새 행은 첫 보드에 들어간다).
           */
          <button
            type="button"
            data-mw-cta="primary"
            onClick={(event) => requestAdd(groupColumn ? valueBlockKey(groupColumn.key, null) : blocks[0].key, event.currentTarget)}
            className="flex h-[34px] shrink-0 items-center rounded-[var(--mw-r-2)] bg-mw-primary px-3.5 text-[length:var(--fs-13)] font-semibold text-mw-on-accent"
          >
            ＋ 업체 추가
          </button>
        ) : board.source === NEW_LEAD_TAB_SOURCE && groups[0] ? (
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

      {/* 보드 이름 «아래» 의 보기 줄 하나 — 뷰 탭 · 보기 조건 · 저장 · 찾기 (BBE-214 순서 · #845 6단계). */}
      <BoardViewBar
        boardId={board.id}
        currentUserId={currentUserId}
        mode={viewMode}
        filters={displayFilters}
        onChange={setFilters}
        groupBy={groupColumn?.key ?? ""}
        groupByOptions={groupByOptions}
        onGroupByChange={changeGroupBy}
        columns={tableColumns}
        rows={displayRows}
        people={people}
        matched={matched}
        total={displayRows.length}
        legacyFacetLabels={canonicalNewLead ? NEW_LEAD_LEGACY_FACET_LABELS : undefined}
        focusFilter={filterFocus}
        canonicalNewLead={canonicalNewLead}
        loadSavedViews={loadSavedViews}
        activeViewId={savedViewId}
        calendarAvailable={calendarAvailable}
        defaultCalendarFieldKey={tableColumns.find((column) => column.type === "date")?.key ?? null}
        ready={filterUrlReady}
      />

      {board.is_system && (
        <p className="rounded-lg border border-mw-line bg-mw-tint-blue px-3 py-2 text-xs text-mw-body">
          시스템 보드입니다. 정책자금 파이프라인의 딜·정산은 전용 화면에서 관리합니다(구조 편집 불가).
        </p>
      )}

      {sortActive && !readOnly && !valueMode && (
        <p className="text-xs text-mw-sub">
          줄 세우기 중에는 행을 끌어 옮길 수 없어요 · 「원래 순서」로 바꾸면 옮길 수 있어요
        </p>
      )}
      {groupValueNotice ? (
        <p role={noticeRole(groupValueNotice.ok)} aria-live={noticeLive(groupValueNotice.ok)} data-group-value-error="" className={`rounded-lg border border-mw-line bg-mw-card px-3 py-2 text-xs ${groupValueNotice.ok ? "text-mw-body" : "text-mw-error"}`}>
          {groupValueNotice.message}
        </p>
      ) : null}
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
          linkCandidates={linkCandidates}
          exportCsv={bulkExport.csv}
          exportFilename={bulkExport.filename}
          dialog={bulkDialog}
          notice={bulkNotice}
          onOpenDialog={openBulkDialog}
          onCloseDialog={() => setBulkDialog(null)}
          onClear={clearSelection}
          onApplied={applyBulkSucceeded}
          onNotice={(message, ok = true) => setBulkNotice({ message, ok })}
        />
      ) : bulkNotice ? (
        <p role={noticeRole(bulkNotice.ok)} aria-live={noticeLive(bulkNotice.ok)} className={`rounded-lg border border-mw-line bg-mw-card px-3 py-2 text-xs ${bulkNotice.ok ? "text-mw-body" : "text-mw-error"}`}>
          {bulkNotice.message}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" role={moveNotice?.includes("못")||moveNotice?.includes("없")?"alert":"status"}>{moveNotice}</p>

      {archivedColumnIds.size > 0 ? (
        <div role="status" className="flex items-center justify-between rounded-lg border border-mw-line bg-mw-card px-3 py-2 text-sm shadow">
          <span>칸을 휴지통으로 옮겼어요.</span>
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
      {/* #845 개선안 — 상세 ⋯·행 우클릭으로 휴지통에 옮긴 행의 「되돌리기」 알림. 행은 곧 사라지므로 보드가 하나 든다. */}
      <ItemTrashUndoToast boardId={board.id} />

      <BoardScrollViewport>
      {sharedHeader ? (
        <GroupTable
          tablePart="head"
          cellFlash={cellFlash}
          workflowProgressKind={workflowProgressKind}
          boardId={board.id}
          boardName={board.name}
          canonicalNewLead={canonicalNewLead}
          currentUserId={currentUserId}
          groupId={null}
          columns={columnsForBlock(stableBlockViews[0].block.key)}
          rows={sharedHeaderRows}
          readOnly={readOnly}
          canManageColumns={!board.is_system && canManageColumns}
          canMoveColumns={sharedColumnsMovable}
          focusColumnKey={savedPresentation.focusColumnKey}
          onColumnArchived={(columnId) => setArchivedColumnIds((current) => new Set(current).add(columnId))}
          scheduleItems={scheduleItems}
          scheduleRecipients={scheduleRecipients}
          hideAddRow
          rowDragEnabled={false}
          dragRowId={null}
          canDropRow={() => false}
          onRowDragStart={startRowDrag}
          onRowDragEnd={endRowDrag}
          onRowDrop={() => {}}
          onColumnDrop={handleSharedColumnDrop}
          onColumnKeyboardMove={handleSharedColumnKeyboardMove}
          onRequestViewCondition={onRequestViewCondition}
          canFilterColumn={canFilterColumn}
          canGroupColumn={canGroupColumn}
          groupByKey={groupColumn?.key ?? ""}
          activeSorts={activeSorts}
          columnCatalog={physicalActiveColumns}
          boardRows={optimisticRows}
          selection={selectedIds}
          onToggleRow={toggleRow}
          onToggleGroup={(checked) => toggleGroupIds(sharedHeaderRows.map((row) => row.id), checked)}
        />
      ) : null}
      {blocks.length === 0 ? (
        /* 원칙 5 — 화면 전체를 차지하는 빈 상태 금지. 한 줄 + 다음 행동. */
        <p className="rounded-md border border-dashed border-mw-line px-3 py-4 text-xs text-mw-sub">
          그룹이 없습니다. 아래 «그룹 추가»로 첫 그룹을 만드세요.
        </p>
      ) : (
        shownBlockViews.map(({ block, visibleRows }) => {
          const storedOrder = canonicalNewLead
            ? presentNewLeadColumnKeys(optimisticOrder[durableLayoutKey(block.key)])
            : optimisticOrder[durableLayoutKey(block.key)];
          const resolvedColumns = resolveColumnOrder(tableColumns, storedOrder ?? undefined);
          // 과거에 저장된 그룹별 배치도 광고 명의 필수 유입정보 위치를 되돌리지 못하게 한다.
          // 서버의 sort_order와 그룹별 사용자 배치를 정본으로 삼는다. 기본 신규리드 순서는
          // revision installer가 안전하게 재배치하며, 회사가 직접 바꾼 순서는 여기서 덮지 않는다.
          const shown = columnsForBlock(block.key);
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
          /*
           * #845 7단계 — 나눠 보기 묶음의 추가: 새 행은 첫 보드에 들어가고 그 묶음의 값을 미리 넣는다.
           * 값을 이 길로 넣을 수 없는 칸이면 「(없음)」 묶음에서만(값 없이) 추가한다. 신규리드는 머리말 등록만 쓴다.
           */
          const valuePrefill = groupColumn && groupValueEditable && block.groupValue?.id
            ? { columnKey: groupColumn.key, value: prefillGroupValue(groupColumn, block.groupValue.id) }
            : null;
          const valueAddAllowed = !readOnly && !canonicalNewLead
            && (valuePrefill !== null || block.groupValue?.id === null);
          const shownName = blockDisplayNames.get(block.key) ?? block.name;

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
              displayName={blockDisplayNames.get(block.key)}
              tone={valueMode ? null : groupTones.get(block.key) ?? null}
              accentColor={block.groupValue?.accent ?? null}
              addLabel={valueMode ? `${shownName}에 ${onDemandAdd ? "업체" : "새 항목"} 추가` : undefined}
              columns={shown}
              rows={visibleRows}
              presetName={groupPresetName(board.name, block.name)}
              presetChanged={isGroupPresetChanged(optimisticOrder[durableLayoutKey(block.key)])}
              nameEditor={block.group && !board.is_system && canManageSections ? (
                <GroupNameEditor
                  boardId={board.id}
                  groupId={block.group.id}
                  name={block.name}
                  display={(saved) => saved === block.name ? blockDisplayNames.get(block.key) ?? presentLabel(saved) : presentLabel(saved)}
                />
              ) : undefined}
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
              onAddRow={valueMode
                ? (valueAddAllowed ? (opener) => requestAdd(block.key, opener) : undefined)
                : onDemandAdd && !(isConsultationStageView || (isNewLeadStageView && !block.group && block.key !== "new-lead-stage:0")) ? (opener) => requestAdd(block.key, opener) : undefined}
              selectControl={sharedBlockKeys.has(block.key) ? (
                <GroupSelectAll
                  name={blockDisplayNames.get(block.key) ?? block.name}
                  state={selectionTriState(selectedIds, visibleRows.map((row) => row.id))}
                  onChange={(checked) => toggleGroupIds(visibleRows.map((row) => row.id), checked)}
                />
              ) : undefined}
              orderControls={block.group && !board.is_system && canManageSections ? (
                <span className="inline-flex" aria-label={`${block.name} 그룹 순서`}>
                  <button type="button" aria-label={`${block.name} 위로 이동`} onClick={() => moveGroup(block.group!.id, -1)} className="rounded px-1 focus:outline-none focus:ring-2 focus:ring-mw-primary">↑</button>
                  <button type="button" aria-label={`${block.name} 아래로 이동`} onClick={() => moveGroup(block.group!.id, 1)} className="rounded px-1 focus:outline-none focus:ring-2 focus:ring-mw-primary">↓</button>
                </span>
              ) : undefined}
            >
              <GroupTable
                tablePart={sharedBlockKeys.has(block.key) ? "body" : "full"}
                addRowMode={onDemandAdd ? "on-demand" : "always"}
                addRequest={addRequest?.key === block.key ? addRequest.seq : 0}
                addReturnFocus={addReturnFocusFor(block.key)}
                boardId={board.id}
                boardName={board.name}
                groupName={block.name}
                canonicalNewLead={canonicalNewLead}
                newLeadMembers={scheduleRecipients}
                {...companyPickerProps}
                itemDetailFixture={itemDetailFixture}
                currentUserId={currentUserId}
                groupId={valueMode ? firstGroupId : block.group?.id ?? (isNewLeadStageView && block.key === "new-lead-stage:0" ? orderedGroups[0]?.id ?? null : null)}
                addPrefill={valuePrefill}
                onRowCreated={valuePrefill ? (itemId) => applyCreatedPrefill(itemId, valuePrefill) : undefined}
                columns={shown}
                detailColumns={[...detailColumns]}
                boardDetailLayout={boardDetailLayout}
                durableDetailColumns={[...physicalDetailColumns]}
                durableBoardDetailLayout={rawBoardDetailLayout}
                durableDetailLayout={rawResolvedDetailLayout.entries}
                rowDetailLayout={isNewLeadStageView ? (row) => {
                  const resolved = resolveRowDetailLayout(rawBoardDetailLayout, orderedGroups, row.group_id);
                  return { durable: resolved.entries, presented: presentNewLeadDetailLayout(resolved.entries), inherited: resolved.inherited };
                } : !block.group ? (row) => {
                  // #654 — 상담 단계 보기의 묶음은 가상이라 물리 그룹이 없다. 추가 폼이 쓰는 곳(row.group_id)을 읽는다.
                  const resolved = resolveRowDetailLayout(rawBoardDetailLayout, orderedGroups, row.group_id);
                  const presented = canonicalNewLead ? presentNewLeadDetailLayout(resolved.entries) : resolved.entries;
                  return {
                    durable: resolved.entries,
                    presented: presented.filter(
                      (entry) => entry.source === "detail" || detailColumns.some((column) => column.key === entry.key),
                    ),
                    inherited: resolved.inherited,
                  };
                } : undefined}
                detailLayout={presentedDetailLayout.filter(
                  (entry) => entry.source === "detail" || detailColumns.some((column) => column.key === entry.key),
                )}
                detailLayoutInherited={rawResolvedDetailLayout.inherited}
                rows={visibleRows}
                parentItems={linkCandidates}
                textMode={savedPresentation.textMode}
                focusColumnKey={savedPresentation.focusColumnKey}
                readOnly={readOnly}
                canDeleteItems={!board.is_system && canDeleteItems}
                authorColumnKey={authorColumnKey}
                viewerUserId={currentUserId}
                canManageColumns={!board.is_system && canManageColumns}
                addLabelOptionAction={addLabelOptionAction}
                onColumnArchived={(columnId) => setArchivedColumnIds((current) => new Set(current).add(columnId))}
                scheduleItems={scheduleItems}
                scheduleRecipients={scheduleRecipients}
                consultationByItem={showConsultationColumn ? consultationByItem : undefined}
                consultationMembers={isContactBoard ? scheduleRecipients : undefined}
                renderConsultationSection={isContactBoard ? (row) => (
                  <ConsultationPanel
                    itemId={row.id}
                    title={row.title}
                    initialMeetingAt={typeof row.values.meeting_at === "string" ? row.values.meeting_at : null}
                    currentAssigneeId={typeof row.assigned_to === "string" ? row.assigned_to : null}
                    members={scheduleRecipients.map((member) => ({ id: member.id, label: member.label }))}
                    initialCompanyName={row.title}
                  />
                ) : undefined}
                hideAddRow={valueMode ? !valueAddAllowed : isConsultationStageView || (isNewLeadStageView && !block.group && block.key !== "new-lead-stage:0")}
                rowDragEnabled={valueMode ? valueDragEnabled : rowDragEnabled && (!isNewLeadStageView || Boolean(block.group))}
                cellFlash={cellFlash}
                cellAction={cellAction}
                workflowProgressKind={workflowProgressKind}
                workflowMoveTargets={workflowMoveTargets}
                canMoveRows={canMoveRows}
                sameTitleCounts={sameTitleCounts}
                onColumnDrop={(draggedKey, targetKey) =>
                  handleColumnDrop(block.key, resolvedColumns, draggedKey, targetKey)
                }
                onColumnKeyboardMove={(columnKey,delta)=>handleColumnKeyboardMove(block.key,resolvedColumns,columnKey,delta)}
                onRequestViewCondition={onRequestViewCondition}
                canFilterColumn={canFilterColumn}
                canGroupColumn={canGroupColumn}
                groupByKey={groupColumn?.key ?? ""}
                activeSorts={activeSorts}
                columnCatalog={physicalActiveColumns}
                boardRows={optimisticRows}
                dragRowId={(valueMode ? valueDragEnabled : rowDragEnabled) ? dragRowId : null}
                canDropRow={canDropInto(block.key)}
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
                onRowDrop={(index) => valueMode
                  ? handleValueDrop(block)
                  : handleRowDrop(block.group?.id ?? null, block.rows, visibleRows, index)
                }
                onRowKeyboardMove={valueMode
                  ? () => setMoveNotice("이 보기에서는 순서를 바꾸지 않아요.")
                  : (rowId,direction)=>keyboardMoveRow(rowId,block.group?.id??null,visibleRows,direction)}
                onRowMoveToGroup={valueMode ? moveRowToValueSection : keyboardMoveRowToGroup}
                groupMoveOptions={valueMode ? valueMoveOptions : groupMoveOptions}
                renderWorkflowTransition={board.source === CONTACT_TAB_SOURCE ? (row) => (
                  workflowTransitionSlot ?? (
                    <>
                      <ConsultationPanel
                        itemId={row.id}
                        title={row.title}
                        initialMeetingAt={typeof row.values.meeting_at === "string" ? row.values.meeting_at : null}
                        currentAssigneeId={typeof row.assigned_to === "string" ? row.assigned_to : null}
                        members={(memberDirectory?.length ? memberDirectory : []).map((member) => ({ id: member.id, label: member.label }))}
                        initialCompanyName={row.title}
                      />
                      {!row.deal_id ? <ContactPipelineAction
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
                      /> : null}
                    </>
                  )
                ) : undefined}
              />
            </GroupBlock>
          );
        })
      )}
      {foldedEmptyCount > 0 ? (
        <div className="sticky left-0 self-start" data-empty-groups-toggle="">
          <button
            type="button"
            aria-expanded={emptyGroupsOpen}
            onClick={() => setEmptyGroupsOpen((open) => !open)}
            className="h-8 rounded-[var(--mw-r-2)] px-3 text-[length:var(--fs-13)] text-mw-sub outline-none hover:bg-mw-card hover:text-mw-fg focus-visible:ring-2 focus-visible:ring-mw-primary"
          >
            {valueMode
              ? (emptyGroupsOpen ? "빈 묶음 접기" : `빈 묶음 ${foldedEmptyCount}개 보기`)
              : (emptyGroupsOpen ? "빈 보드 접기" : `빈 보드 ${foldedEmptyCount}개 보기`)}
          </button>
        </div>
      ) : null}
      </BoardScrollViewport>
    </div>
    </TabChromeProvider>
    </CellSaveContext.Provider>
  );
}
