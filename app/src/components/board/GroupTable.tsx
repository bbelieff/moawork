"use client";

/**
 * 그룹 하나의 표 — 밀도·sticky·드래그 (ui-guidelines 원칙 6 · PLAN-002 WO-2 ⓑⓒ).
 *
 * 밀도: 행 36px(원칙 6 의 34~40px), 셀 패딩 8px, 컬럼 최소폭 6rem.
 *
 * sticky 두 축을 **한 스크롤 컨테이너**에서 처리한다. `overflow-x:auto` 를 걸면 CSS 규약상
 * overflow-y 도 visible 로 남을 수 없어(auto 로 승격) 페이지 스크롤 기준 sticky 헤더가
 * 깨진다 — 그래서 컨테이너에 max-height 를 주고 그 안에서 헤더(top-0)와 첫 열(left-0)이
 * 함께 고정되게 했다. 행이 적은 그룹은 max-height 에 닿지 않아 내부 스크롤바가 아예 안 뜬다.
 *
 * 드래그는 외부 라이브러리 없이 HTML5 DnD 로 한다(의존성 0 유지):
 *  - 컬럼: `<th>` 를 끌어 다른 `<th>` 에 놓으면 **그 그룹만** 배치가 바뀐다.
 *  - 행: 손잡이를 끌어 행 사이·다른 그룹에 놓는다. 그룹 간 이동은 부모가 처리한다.
 * 낙관적 갱신(useOptimistic)은 부모(BoardWorkspace)가 담당하고 여기서는 이벤트만 올린다.
 */

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BoardColumn,
  CellValue,
  ItemWithValues,
} from "@/lib/boards/types";
import { formatCell } from "@/lib/boards/cells";
import { presentPhone } from "@/lib/format/phone";
import { findCellError, type CellFlash } from "@/lib/boards/cellFlash";
import {
  getFieldSourceSpec,
  isSourceEditable,
  sourceRequiresConfirm,
} from "@/lib/field/source";
import { fieldTypeLabel } from "@/lib/field/type-labels";
import { StatusCell, StatusSelect } from "@/components/boards/StatusCell";
import { SourceBadge } from "./FieldBadge";
import { clampWidth } from "./layout";
import type { DetailLayoutEntry } from "@/lib/boards/detail-layout";
import { DealLedgerButton } from "./DealLedgerButton";
import { ItemDetailPanel } from "./ItemDetailPanel";
import type { ItemDetailSnapshot } from "@/app/(app)/boards/item-detail-actions";
import { TrashItemButton } from "./ItemTrashControls";
import { AddItemForm } from "./AddItemForm";
import { ContractWorkIntakeForm } from "./ContractWorkIntakeForm";
import type { CompanyPickerRow } from "@/lib/companies/search";
import type { CompanyIntakeResult } from "@/lib/companies/intake-result";
import { ColumnContextMenu } from "./ColumnContextMenu";
import type {
  ColumnScheduleItemOption,
  ColumnScheduleRecipientOption,
} from "./ColumnSettingsPanel";
import { NewLeadIntakeForm } from "./NewLeadIntakeForm";
import { MemberPicker, type MemberPickerMember } from "./MemberPicker";
import { NewLeadMessageCell } from "./NewLeadMessageCell";
import { WorkflowProgressCell } from "./WorkflowProgressCell";
import {
  WORKFLOW_PROGRESS_KEY,
  workflowProgressSpec,
  type WorkflowProgressKind,
} from "@/lib/workflow/progress";
import {
  updateNewLeadFieldAction,
  updateNewLeadMetaAction,
  updateNewLeadTitleAction,
} from "@/app/(app)/boards/new-lead-actions";
import {
  renameItemAction,
  setCellAction,
  setColumnWidthAction,
} from "@/app/(app)/boards/actions";

const CELL_INPUT =
  "w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-mw-fg outline-none hover:border-mw-line focus:border-mw-record";

/** 헤더/셀 공통 — 첫 열(이름)을 가로 스크롤에서 고정한다. */
const STICKY_FIRST = "sticky left-0 z-[var(--mw-layer-board-cell)] bg-mw-card";

function inputTypeOf(type: BoardColumn["type"]): string {
  switch (type) {
    case "number":
    case "money":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "email":
      return "email";
    case "url":
      return "url";
    case "phone":
      return "tel";
    default:
      return "text";
  }
}

export function cellInputValue(
  type: BoardColumn["type"],
  value: CellValue,
  phoneStatus: "normalized" | "needs_review" = "normalized",
): string | number {
  if (value === null) return "";
  if (type === "phone") return presentPhone(typeof value === "string" ? value : null, phoneStatus);
  if (type === "datetime" && typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value.slice(0, 16)
      : parsed.toISOString().slice(0, 16);
  }
  if (type === "date" && typeof value === "string") return value.slice(0, 10);
  return typeof value === "number" ? value : String(value);
}

/**
 * 컬럼 타입·출처 조합 툴팁 — 목업 정본과 동일하게 셀에 hover 하면 뜬다(D09).
 * 타입은 헤더에 따로 배지를 그리지 않으므로 여기가 유일한 타입 노출 지점이다.
 */
function cellTitle(column: BoardColumn): string {
  const sourceSpec = getFieldSourceSpec(column.source);
  return `${column.label} — ${fieldTypeLabel(column.type)} · ${sourceSpec.label}(${sourceSpec.description})${column.description ? ` · ${column.description}` : ""}`;
}

const NUMERIC_TYPES = new Set(["money", "number"]);
const NEW_LEAD_FIELD_KEYS: Readonly<Record<string, string>> = {
  rep_name: "representative_name",
  phone: "phone",
  email: "email",
  biz_reg_type: "business_registration_type",
  business_registration_type: "business_registration_type",
  industry: "industry",
  revenue_band: "revenue_band",
  sido: "region_sido",
  region_sido: "region_sido",
  sigungu: "region_sigungu",
  region_sigungu: "region_sigungu",
  ad_name: "acquisition_source",
  acquisition_source: "acquisition_source",
};

const NEW_LEAD_EMPTY_LABELS: Readonly<Record<string, string>> = {
  absence_notice: "해당 없음",
  consult1_notice: "해당 없음",
  confirm2_notice: "해당 없음",
  feedback_status: "미입력",
  recall_at: "일정 없음",
  meeting_at: "일정 없음",
  recontact_on: "일정 없음",
  contract_fee: "미정",
};
const NEW_LEAD_META_KEYS = new Set(["owner", "collaborators", "applied_on"]);

/** 한 셀 — 읽기 전용이면 표시만, 아니면 셀 단위 서버 액션 폼. */
export function BoardCell({
  boardId,
  row,
  column,
  readOnly,
  canonicalNewLead,
  members = [],
  error,
  workflowProgressKind,
  workflowTransitionAction,
  cellAction,
}: {
  boardId: string;
  row: ItemWithValues;
  column: BoardColumn;
  readOnly: boolean;
  canonicalNewLead?: boolean;
  members?: readonly { id: string; label: string }[];
  error?: string | null;
  workflowProgressKind?: WorkflowProgressKind | null;
  workflowTransitionAction?: ReactNode;
  /** 결정론적 화면 검증에서만 저장소 경계를 바꾼다. 실제 셀 폼/제출 흐름은 그대로 둔다. */
  cellAction?: (formData: FormData) => Promise<void>;
}) {
  const value = row.values[column.key] ?? null;
  const phoneStatus = row.value_statuses?.[column.key] ?? "normalized";
  const options = column.options_jsonb?.options ?? [];
  // 출처가 편집을 막는 칸(⇄ 연동·ƒ 수식)은 보드가 편집 가능해도 클릭해도 열리지 않는다 — D09 수용기준.
  //
  // `is_readonly` 도 같이 본다(BBE-145). 서비스는 이미 이 칸의 쓰기를 전부 거부하는데
  // (`boards/service.ts` — "읽기 전용 칸") 표는 그걸 안 보고 편집창을 열어 줬다.
  // 결과: 사용자가 고칠 수 있는 것처럼 보이고, 저장을 눌러야 거부당한다.
  // ✉ 발송 칸에서는 더 나쁘다 — 안전장치(BBE-148)가 붙는 순간 «열려 있는 편집창» 이
  // 곧 돈이 나가는 통로가 된다. 화면과 서버가 같은 답을 해야 한다.
  const canonicalField = canonicalNewLead
    ? NEW_LEAD_FIELD_KEYS[column.key]
    : undefined;
  const auditedCanonicalEdit = Boolean(canonicalField && row.deal_id);
  const auditedMetaEdit = Boolean(
    canonicalNewLead && row.deal_id && NEW_LEAD_META_KEYS.has(column.key),
  );
  const cellReadOnly =
    readOnly ||
    (!auditedCanonicalEdit &&
      !auditedMetaEdit &&
      !isSourceEditable(column.source)) ||
    column.is_readonly === true;
  const numeric = NUMERIC_TYPES.has(column.type);
  const title = cellTitle(column);
  const emptyLabel =
    canonicalNewLead && value === null
      ? NEW_LEAD_EMPTY_LABELS[column.key]
      : undefined;

  if (canonicalNewLead && column.key === "message_action") {
    return <NewLeadMessageCell row={row} />;
  }

  if (column.key === WORKFLOW_PROGRESS_KEY && workflowProgressKind) {
    return (
      <WorkflowProgressCell
        boardId={boardId}
        row={row}
        column={column}
        kind={workflowProgressKind}
        readOnly={readOnly}
        error={error}
        transitionAction={workflowTransitionAction}
        cellAction={cellAction}
      />
    );
  }

  if (cellReadOnly) {
    const display =
      column.type === "select" ||
      column.type === "status" ||
      column.type === "person" ||
      column.type === "multiselect" ||
      column.type === "people" ? (
        emptyLabel ? (
          <span className="text-xs text-mw-sub">{emptyLabel}</span>
        ) : (
          <StatusCell value={value} options={options} />
        )
      ) : (
        <span
          className={`truncate text-xs text-mw-body ${numeric ? "block text-right tabular-nums" : ""}`}
        >
          {(column.type === "phone" ? presentPhone(typeof value === "string" ? value : null, phoneStatus) : formatCell(column.type, value, options)) || emptyLabel || "—"}
          {column.source === "lk" && value !== null ? (
            <span
              aria-hidden="true"
              className="ml-1 text-mw-automation"
              title="업체 마스터에서 자동으로 채워집니다"
            >
              ⇄
            </span>
          ) : null}
        </span>
      );
    return (
      <span title={title} className="block">
        {display}
      </span>
    );
  }

  const errorId = error ? `mwcell-${row.id}-${column.key}` : undefined;
  const needsConfirm = sourceRequiresConfirm(column.source);

  return (
    <div className="flex flex-col" title={title}>
      <form
        action={
          auditedCanonicalEdit
            ? updateNewLeadFieldAction
            : auditedMetaEdit
              ? updateNewLeadMetaAction
              : cellAction ?? setCellAction
        }
        aria-describedby={errorId}
        onSubmit={
          needsConfirm
            ? (e) => {
                if (
                  !window.confirm(
                    `«${column.label}» 값을 바꾸면 고객에게 문자가 발송되고 비용이 듭니다. 계속할까요?`,
                  )
                ) {
                  e.preventDefault();
                }
              }
            : undefined
        }
      >
        <input type="hidden" name="boardId" value={boardId} />
        <input type="hidden" name="itemId" value={row.id} />
        <input type="hidden" name="columnKey" value={column.key} />
        {auditedCanonicalEdit ? (
          <>
            <input type="hidden" name="dealId" value={row.deal_id ?? ""} />
            <input type="hidden" name="field" value={canonicalField} />
          </>
        ) : null}
        {auditedMetaEdit ? (
          <>
            <input type="hidden" name="dealId" value={row.deal_id ?? ""} />
            <input type="hidden" name="field" value={column.key} />
          </>
        ) : null}

        {column.type === "file" ? (
          <span className="flex items-center gap-1">
            {typeof value === "string" && value.startsWith("/api/") ? (
              <a href={value} className="text-xs underline">
                내려받기
              </a>
            ) : null}
            <input
              type="file"
              name="value"
              aria-label={column.label}
              className={CELL_INPUT}
            />
          </span>
        ) : column.type === "checkbox" ? (
          <>
            <input type="hidden" name="kind" value="checkbox" />
            <input
              type="checkbox"
              name="value"
              defaultChecked={value === true}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="h-3.5 w-3.5"
              aria-label={column.label}
            />
          </>
        ) : column.type === "select" || column.type === "status" ? (
          <StatusSelect
            name="value"
            value={value}
            options={options}
            className={`${CELL_INPUT} cursor-pointer`}
          />
        ) : column.type === "person" ? (
          <>
            <input type="hidden" name="kind" value="person" />
            <MemberPicker label={column.label} members={members.length > 0 ? members : options.map(({ id, label }) => ({ id, label }))} value={typeof value === "string" ? value : null} multiple={false} compact={canonicalNewLead} />
          </>
        ) : column.type === "people" ? (
          <>
            <input type="hidden" name="kind" value="people" />
            <MemberPicker label={column.label} members={members.length > 0 ? members : options.map(({ id, label }) => ({ id, label }))} value={Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []} multiple compact={canonicalNewLead} />
          </>
        ) : column.type === "multiselect" ? (
          <select
            name="value"
            multiple
            defaultValue={Array.isArray(value) ? value : []}
            className={`${CELL_INPUT} h-12`}
            aria-label={column.label}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={inputTypeOf(column.type)}
            name="value"
            defaultValue={cellInputValue(column.type, value, phoneStatus)}
            placeholder={emptyLabel ?? "—"}
            aria-label={column.label}
            className={`${CELL_INPUT} ${numeric ? "text-right tabular-nums" : ""}`}
          />
        )}

        {/* select/multiselect 는 변경만으로 저장되지 않으므로 명시 저장을 남긴다. */}
        {(column.type === "select" ||
          column.type === "status" ||
          column.type === "person" ||
          column.type === "multiselect" ||
          column.type === "people") && (
          <button type="submit" className="sr-only">
            {column.label} 저장
          </button>
        )}
      </form>

      {/* 관대 정책상 이 셀만 저장 실패했을 수 있다 — 그 사실을 그 자리에 드러낸다. */}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="px-1.5 text-[0.65rem] text-mw-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function GroupTable({
  boardId,
  boardName,
  groupName,
  canonicalNewLead = false,
  companyPicker,
  newLeadMembers = [],
  itemDetailFixture,
  currentUserId,
  groupId,
  columns,
  detailColumns = [...columns],
  boardDetailLayout = [],
  detailLayout = [],
  detailLayoutInherited = true,
  rows,
  readOnly,
  canDeleteItems = !readOnly,
  authorColumnKey,
  viewerUserId,
  canManageColumns = !readOnly,
  rowDragEnabled,
  cellFlash,
  onColumnDrop,
  dragRowId,
  canDropRow,
  onRowDragStart,
  onRowDragEnd,
  onRowDrop,
  renderRowAction,
  workflowProgressKind = null,
  renderWorkflowTransition,
  textMode = "single",
  focusColumnKey = null,
  onColumnArchived,
  scheduleItems = [],
  scheduleRecipients = [],
  cellAction,
}: {
  boardId: string;
  boardName?: string;
  groupName?: string;
  canonicalNewLead?: boolean;
  /**
   * 계약업체 실무의 「＋ 업체 추가」. 있으면 이름 입력칸 대신 «회사 고르기» 를 그린다.
   * 이 보드의 한 줄은 «어느 회사의 자금 건» 이라, 이름만 받으면 같은 회사가 표기만
   * 달리해서 여러 번 들어온다 — 목업이 그걸 막으려고 회사부터 찾게 했다.
   */
  companyPicker?: {
    rows: readonly CompanyPickerRow[];
    action: (
      prev: CompanyIntakeResult,
      formData: FormData,
    ) => Promise<CompanyIntakeResult>;
  };
  // 담당자 선택 타입은 main 쪽(#576)이 넓혔다 — 내 브랜치의 좁은 형태로 되돌리지 않는다.
  newLeadMembers?: readonly MemberPickerMember[];
  itemDetailFixture?: ItemDetailSnapshot;
  currentUserId?: string;
  /** 이 그룹의 group_id. "그룹 없음" 블록은 null. */
  groupId: string | null;
  /** 오버라이드·컬럼수까지 적용된 **최종 표시 순서**. */
  columns: readonly BoardColumn[];
  /** 상세 패널은 표의 표시 제한과 무관하게 전체 컬럼 정의를 사용한다. */
  detailColumns?: BoardColumn[];
  boardDetailLayout?: DetailLayoutEntry[];
  detailLayout?: DetailLayoutEntry[];
  detailLayoutInherited?: boolean;
  rows: readonly ItemWithValues[];
  readOnly: boolean;
  canDeleteItems?: boolean;
  /** BBE-239 — 이 키가 있으면 그 컬럼 값이 `viewerUserId` 와 같은 행은 role 권한 없이도 삭제 버튼을 보여준다(작성자 예외, 공지사항 한정). 서버가 다시 검증한다 — 여긴 표시 전용. */
  authorColumnKey?: string;
  viewerUserId?: string;
  canManageColumns?: boolean;
  /** 정렬이 켜져 있으면 부모가 false 를 준다 — 손잡이 자체를 감춰 헛짚을 자리를 없앤다. */
  rowDragEnabled: boolean;
  cellFlash: CellFlash | null;
  onColumnDrop: (draggedKey: string, targetKey: string) => void;
  /** 지금 끌고 있는 행 id(다른 그룹의 행일 수 있다) — **표시 전용**. 없으면 null. */
  dragRowId: string | null;
  /** 드롭을 받아도 되는지의 **판정**. 리렌더 타이밍과 무관하게 부모 ref 를 즉시 읽는다. */
  canDropRow: () => boolean;
  onRowDragStart: (itemId: string) => void;
  onRowDragEnd: () => void;
  /** 이 그룹의 index 위치에 놓는다. */
  onRowDrop: (index: number) => void;
  renderRowAction?: (row: ItemWithValues) => ReactNode;
  /** 화면의 통합 진행현황 셀. 실제 저장은 기존 단계/이동 계약을 그대로 소비한다. */
  workflowProgressKind?: WorkflowProgressKind | null;
  renderWorkflowTransition?: (row: ItemWithValues) => ReactNode;
  textMode?: "single" | "wrap";
  focusColumnKey?: string | null;
  onColumnArchived?: (columnId: string) => void;
  scheduleItems?: readonly ColumnScheduleItemOption[];
  scheduleRecipients?: readonly ColumnScheduleRecipientOption[];
  cellAction?: (formData: FormData) => Promise<void>;
}) {
  /*
   * 드래그 중인 대상은 **ref 가 정본**이고 state 는 표시(반투명·강조)에만 쓴다.
   * dragstart → drop 사이에 리렌더가 반드시 일어난다고 가정하면 안 되기 때문이다
   * (같은 틱에 이어지는 이벤트에서는 state 가 아직 옛 값이라 드롭이 조용히 무시된다).
   * ref 는 그 자리에서 값이 바뀌므로 타이밍과 무관하게 항상 옳다.
   */
  const dragColRef = useRef<string | null>(null);
  const [dragColKey, setDragColKey] = useState<string | null>(null);
  const [overColKey, setOverColKey] = useState<string | null>(null);
  const [overRowIndex, setOverRowIndex] = useState<number | null>(null);

  const clearColDrag = () => {
    dragColRef.current = null;
    setDragColKey(null);
    setOverColKey(null);
  };

  const colSpan = columns.length + 1;

  /*
   * 컬럼 폭 조절(D12) — 드래그 중인 값은 dragColRef 와 같은 이유로 ref 가 정본이다
   * (mousemove 는 리렌더 사이클과 무관하게 계속 들어온다). state(liveWidths)는 화면
   * 갱신용이고, 서버 저장은 mouseup 에서 한 번만 나간다.
   */
  const resizeRef = useRef<{
    columnId: string;
    startX: number;
    startWidth: number;
    current: number;
  } | null>(null);
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});

  const commitWidth = useCallback(
    (columnId: string, width: number | null) => {
      startTransition(async () => {
        const fd = new FormData();
        fd.set("boardId", boardId);
        fd.set("columnId", columnId);
        fd.set("width", width === null ? "" : String(width));
        await setColumnWidthAction(fd);
      });
    },
    [boardId],
  );

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const r = resizeRef.current;
      if (!r) return;
      r.current = clampWidth(r.startWidth + (e.clientX - r.startX));
      setLiveWidths((w) => ({ ...w, [r.columnId]: r.current }));
    }
    function onUp() {
      const r = resizeRef.current;
      resizeRef.current = null;
      if (!r) return;
      commitWidth(r.columnId, r.current);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [commitWidth]);

  const startResize =
    (columnId: string) => (e: React.MouseEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const th = e.currentTarget.closest("th");
      const startWidth = th ? th.getBoundingClientRect().width : 160;
      resizeRef.current = {
        columnId,
        startX: e.clientX,
        startWidth,
        current: startWidth,
      };
    };

  const resetWidth = (columnId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLiveWidths((w) => {
      const next = { ...w };
      delete next[columnId];
      return next;
    });
    commitWidth(columnId, null);
  };

  const acceptRow = (index: number) => (e: React.DragEvent) => {
    if (!canDropRow()) return;
    e.preventDefault();
    setOverRowIndex(index);
  };

  const dropRow = (index: number) => (e: React.DragEvent) => {
    if (!canDropRow()) return;
    e.preventDefault();
    setOverRowIndex(null);
    onRowDrop(index);
  };

  return (
    <div className="relative isolate max-h-[70vh] min-w-0 max-w-full overflow-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th
              scope="col"
              className={`${STICKY_FIRST} z-[var(--mw-layer-board-corner)] min-w-44 border-b border-mw-line px-2 py-1.5 text-xs font-semibold text-mw-sub`}
              style={{ top: 0, position: "sticky" }}
            >
              {canonicalNewLead ? (
                <span className="flex items-center gap-1"><SourceBadge source="auto" />회사명</span>
              ) : "이름"}
            </th>
            {columns.map((col) => {
              const isTarget = overColKey === col.key && dragColKey !== col.key;
              const width = liveWidths[col.id] ?? col.width ?? undefined;
              const workflowLocked = col.key === WORKFLOW_PROGRESS_KEY;
              return (
                <th
                  key={col.id}
                  scope="col"
                  draggable={canManageColumns && !workflowLocked}
                  onDragStart={() => {
                    if (workflowLocked) return;
                    dragColRef.current = col.key;
                    setDragColKey(col.key);
                  }}
                  onDragEnd={clearColDrag}
                  onDragOver={(e) => {
                    if (!dragColRef.current) return;
                    e.preventDefault();
                    setOverColKey(col.key);
                  }}
                  onDrop={(e) => {
                    const dragged = dragColRef.current;
                    if (!dragged) return;
                    e.preventDefault();
                    if (dragged !== col.key) onColumnDrop(dragged, col.key);
                    clearColDrag();
                  }}
                  title={
                    !canManageColumns || workflowLocked
                      ? cellTitle(col)
                      : `${cellTitle(col)} — 끌어서 이 그룹의 컬럼 순서 변경`
                  }
                  style={width ? { width, minWidth: width } : undefined}
                  data-view-focus={col.key === focusColumnKey || undefined}
                  data-column-key={col.key}
                  data-right-pinned={col.rightPinned || undefined}
                  className={`relative sticky top-0 z-[var(--mw-layer-board-header)] min-w-20 border-b border-r border-mw-line px-2 py-1.5 text-xs font-semibold text-mw-sub ${col.key === focusColumnKey ? "bg-mw-tint-blue" : col.rightPinned ? "bg-mw-tint-blue" : "bg-mw-card"} ${
                    !canManageColumns || workflowLocked
                      ? ""
                      : "cursor-grab active:cursor-grabbing"
                  } ${isTarget ? "bg-mw-tint-blue text-mw-record" : ""} ${
                    dragColKey === col.key ? "opacity-50" : ""
                  } ${col.rightPinned ? "right-0 border-l-2 border-l-mw-primary text-mw-record" : ""}`}
                >
                  <span className="flex items-center gap-1">
                    {canManageColumns && (
                      <span
                        aria-hidden="true"
                        className={workflowLocked ? "hidden" : "text-[0.6rem] opacity-40"}
                      >
                        ⠿
                      </span>
                    )}
                    {canManageColumns && !workflowLocked ? (
                      <ColumnContextMenu
                        boardId={boardId}
                        column={col}
                        scheduleItems={scheduleItems}
                        scheduleRecipients={scheduleRecipients}
                        onArchived={onColumnArchived}
                      >
                        <SourceBadge source={col.source} />
                        <span className="truncate">{col.label}</span>
                      </ColumnContextMenu>
                    ) : (
                      <>
                        <SourceBadge source={col.source} />
                        <span className="truncate">{col.label}</span>
                      </>
                    )}
                  </span>
                  {canManageColumns && !workflowLocked && (
                    <span
                      aria-hidden="true"
                      draggable={false}
                      onMouseDown={startResize(col.id)}
                      onDoubleClick={resetWidth(col.id)}
                      title="끌어서 폭 조절 · 두 번 누르면 원래대로"
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-mw-record/40"
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 && (
            /* 원칙 5 — 빈 상태는 표 안 1줄. 동시에 첫 행의 드롭 자리이기도 하다. */
            <tr onDragOver={acceptRow(0)} onDrop={dropRow(0)}>
              <td
                colSpan={colSpan}
                className={`border-b border-mw-line px-3 py-3 text-xs text-mw-sub ${
                  overRowIndex === 0 ? "bg-mw-tint-blue" : ""
                }`}
              >
                {dragRowId
                  ? "여기에 놓으면 이 그룹으로 이동합니다"
                  : "행이 없습니다."}
              </td>
            </tr>
          )}

          {rows.map((row, index) => {
            const canDeleteRow =
              canDeleteItems ||
              (authorColumnKey !== undefined &&
                viewerUserId !== undefined &&
                row.values[authorColumnKey] === viewerUserId);
            return (
              <tr
                key={row.id}
                onDragOver={acceptRow(index)}
                onDrop={dropRow(index)}
                className={`group ${canonicalNewLead ? "h-8" : "h-9"} hover:bg-mw-bg ${
                  dragRowId === row.id ? "opacity-40" : ""
                } ${overRowIndex === index ? "border-t-2 border-t-mw-record" : ""}`}
              >
                <td
                  className={`${STICKY_FIRST} border-b border-r border-mw-line px-2 group-hover:bg-mw-bg`}
                >
                  <div className="flex items-center gap-1">
                    {rowDragEnabled && (
                      <span
                        draggable
                        onDragStart={() => onRowDragStart(row.id)}
                        onDragEnd={() => {
                          onRowDragEnd();
                          setOverRowIndex(null);
                        }}
                        title="끌어서 행 순서·그룹 이동"
                        aria-label="행 이동 손잡이"
                        className="cursor-grab text-[0.7rem] text-mw-sub opacity-30 group-hover:opacity-100 active:cursor-grabbing"
                      >
                        ⠿
                      </span>
                    )}

                    {readOnly ? (
                      <span className="truncate text-xs font-medium text-mw-fg">
                        {row.title}
                      </span>
                    ) : (
                      <>
                        <form
                          action={
                            canonicalNewLead && row.deal_id
                              ? updateNewLeadTitleAction
                              : renameItemAction
                          }
                          className="min-w-0 flex-1"
                        >
                          <input type="hidden" name="boardId" value={boardId} />
                          <input type="hidden" name="itemId" value={row.id} />
                          {canonicalNewLead && row.deal_id ? (
                            <input
                              type="hidden"
                              name="dealId"
                              value={row.deal_id}
                            />
                          ) : null}
                          <input
                            name="title"
                            defaultValue={row.title}
                            aria-label="행 이름"
                            className={`${CELL_INPUT} font-medium`}
                          />
                        </form>
                        {findCellError(cellFlash, row.id, "title") ? (
                          <p
                            role="alert"
                            className="text-[0.65rem] text-mw-error"
                          >
                            {findCellError(cellFlash, row.id, "title")}
                          </p>
                        ) : null}
                      </>
                    )}

                    <ItemDetailPanel
                      boardId={boardId}
                      boardName={boardName}
                      groupName={groupName}
                      row={row}
                      columns={detailColumns}
                      boardLayout={boardDetailLayout}
                      layout={detailLayout}
                      inherited={detailLayoutInherited}
                      canEditItems={!readOnly}
                      canManageColumns={canManageColumns}
                      canonicalNewLead={canonicalNewLead}
                      memberOptions={newLeadMembers}
                      initialDetail={itemDetailFixture}
                      previousItem={
                        index > 0
                          ? {
                              id: rows[index - 1].id,
                              title: rows[index - 1].title,
                            }
                          : undefined
                      }
                      nextItem={
                        index < rows.length - 1
                          ? {
                              id: rows[index + 1].id,
                              title: rows[index + 1].title,
                            }
                          : undefined
                      }
                    />

                    {/* BBE-240 — 자금건과 연결된 행(BBE-235 프로젝션 트리거가 채운 deal_id)에만
                        뜬다. 컬럼이 아니라 행 자체에 조건부로 붙인다 — TrashItemButton 과 같은 자리. */}
                    {!canonicalNewLead && row.deal_id && <DealLedgerButton dealId={row.deal_id} />}

                    {canDeleteRow && (
                      <TrashItemButton
                        boardId={boardId}
                        itemId={row.id}
                        title={row.title}
                      />
                    )}
                  </div>
                  {renderRowAction?.(row)}
                </td>

                {columns.map((col) => (
                  <td
                    key={col.id}
                    data-view-focus={col.key === focusColumnKey || undefined}
                    data-column-key={col.key}
                    data-right-pinned={col.rightPinned || undefined}
                    className={`border-b border-r border-mw-line px-2 align-middle group-hover:bg-mw-bg ${(col.wrap_mode ?? textMode) === "wrap" ? "whitespace-normal break-words" : "max-w-80 truncate whitespace-nowrap"} ${col.key === focusColumnKey ? "bg-mw-tint-blue" : ""} ${
                      col.rightPinned
                        ? "sticky right-0 z-[var(--mw-layer-board-cell)] border-l-2 border-l-mw-primary bg-mw-tint-blue"
                        : ""
                    }`}
                  >
                    <BoardCell
                      boardId={boardId}
                      row={row}
                      column={col}
                      readOnly={readOnly}
                      canonicalNewLead={canonicalNewLead}
                      members={newLeadMembers}
                      error={
                        cellFlash
                          ? findCellError(
                              cellFlash,
                              row.id,
                              col.key === WORKFLOW_PROGRESS_KEY && workflowProgressKind
                                ? workflowProgressSpec(workflowProgressKind).stageColumnKey
                                : col.key,
                            )
                          : null
                      }
                      workflowProgressKind={workflowProgressKind}
                      workflowTransitionAction={renderWorkflowTransition?.(row)}
                      cellAction={cellAction}
                    />
                  </td>
                ))}
              </tr>
            );
          })}

          {!readOnly && (
            /* 마지막 줄 = 새 항목 입력 + 그룹 맨 끝 드롭 자리(원칙 5). */
            <tr
              onDragOver={acceptRow(rows.length)}
              onDrop={dropRow(rows.length)}
            >
              <td
                colSpan={colSpan}
                className={`px-2 py-1 ${overRowIndex === rows.length ? "bg-mw-tint-blue" : ""}`}
              >
                {canonicalNewLead && groupId ? (
                  <NewLeadIntakeForm
                    boardId={boardId}
                    groupId={groupId}
                    members={newLeadMembers}
                    currentUserId={currentUserId}
                  />
                ) : companyPicker ? (
                  <ContractWorkIntakeForm
                    rows={companyPicker.rows}
                    startWorkAction={companyPicker.action}
                    inputClassName={`${CELL_INPUT} w-full max-w-md`}
                  />
                ) : (
                  <AddItemForm
                    boardId={boardId}
                    variant="inline"
                    groupId={groupId}
                    inputClassName={`${CELL_INPUT} max-w-64`}
                  />
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
