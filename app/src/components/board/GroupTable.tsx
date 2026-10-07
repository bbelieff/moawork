"use client";

/**
 * 그룹 하나의 표 — 밀도·sticky·드래그 (ui-guidelines 원칙 6 · PLAN-002 WO-2 ⓑⓒ).
 *
 * 밀도: 행 32px, 셀 패딩 8px, 컬럼 최소폭 6rem.
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
import { renameColumnTitleAction } from "@/app/(app)/boards/title-actions";
import type {
  BoardColumn,
  CellValue,
  ItemWithValues,
} from "@/lib/boards/types";
import { formatCell } from "@/lib/boards/cells";
import { NEW_LEAD_FIELD_KEYS } from "@/lib/new-lead/cell-fields";
import { presentPhone } from "@/lib/format/phone";
import { findCellError, type CellFlash } from "@/lib/boards/cellFlash";
import {
  getFieldSourceSpec,
  isSourceEditable,
  sourceRequiresConfirm,
} from "@/lib/field/source";
import { fieldTypeLabel } from "@/lib/field/type-labels";
import { StatusCell } from "@/components/boards/StatusCell";
import { LabelCombobox } from "./LabelCombobox";
import { canCreateLabelForColumn, newLabelRequestId } from "@/lib/boards/label-options";
import type { AddLabelOptionInput, AddLabelOptionResult } from "@/app/(app)/boards/label-option-actions";
import { SourceBadge } from "./FieldBadge";
import { clampWidth, fixedColumnWidth } from "./layout";
import { useLiveColumnWidths } from "./column-live-width";
import type { DetailLayoutEntry } from "@/lib/boards/detail-layout";
import { ItemDetailPanel } from "./ItemDetailPanel";
import type { ItemDetailSnapshot } from "@/app/(app)/boards/item-detail-actions";
import { TrashItemButton } from "./ItemTrashControls";
import { AddItemForm } from "./AddItemForm";
import { ContractWorkIntakeForm } from "./ContractWorkIntakeForm";
import type { CompanyPickerRow } from "@/lib/companies/search";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";
import { ColumnContextMenu } from "./ColumnContextMenu";
import type {
  ColumnScheduleItemOption,
  ColumnScheduleRecipientOption,
} from "./ColumnSettingsPanel";
import { NewLeadIntakeForm } from "./NewLeadIntakeForm";
import { MemberPicker, type MemberPickerMember } from "./MemberPicker";
import { AssignmentLineagePopover } from "./AssignmentLineagePopover";
import { NewLeadMessageCell } from "./NewLeadMessageCell";
import { NewLeadLoanCell } from "./NewLeadLoanCell";
import { NewLeadCreditScoresCell } from "./NewLeadCreditScoresCell";
import { NewLeadFoundedDateCell } from "./NewLeadFoundedDateCell";
import { NewLeadRevenue3yCell } from "./NewLeadRevenue3yCell";
import {
  CREDIT_SCORE_KEYS,
  EXISTING_LOAN_KEYS,
  NEW_LEAD_COMPOSITE_FIELD_KEYS,
} from "@/lib/new-lead/financial-profile";
import { isNewLeadPresentationOnlyStructure } from "@/lib/default-tabs/new-lead";
import { WorkflowProgressCell } from "./WorkflowProgressCell";
import { OtherInfoBoardCell } from "./OtherInfoBoardCell";
import { OTHER_INFO_COLUMN_KEY, otherInfoLegacyFromValues } from "@/lib/boards/structured-field";
import {
  WORKFLOW_PROGRESS_KEY,
  workflowProgressSpec,
  type WorkflowProgressKind,
  type WorkflowStageMoveTargets,
} from "@/lib/workflow/progress";
import { ConsultationProgressCell } from "@/components/consultation/ConsultationProgressCell";
import {
  CONSULTATION_PROGRESS_KEY,
  withRowContractFee,
  type ConsultationBoardEntry,
  type ConsultationBoardMap,
} from "@/lib/consultation/boardView";
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
import {
  BOARD_TABLE_BODY_CELL,
  BOARD_TABLE_CONTROL,
  BOARD_TABLE_HEADER_CELL,
  BOARD_TABLE_ROW,
  BOARD_TABLE_TITLE_CONTROL,
} from "./table-style";
import { BoardInlineTitleEditor } from "./BoardInlineTitleEditor";
import { claimBoardTransientSurface } from "./BoardAnchoredMenu";
import { selectionTriState } from "./bulk-selection";
import { MAX_FILE_BYTES } from "@/lib/services/file-contract";
import { RegionCell } from "./RegionPairCell";
import { isRegionSidoKey, isRegionSigunguKey } from "@/lib/new-lead/region-pair";
import { clampTitleWidth, TITLE_COLUMN_DEFAULT, TITLE_COLUMN_MAX, TITLE_COLUMN_MIN, TITLE_COLUMN_STEP, useTitleColumnWidth } from "./title-column-width";

const CELL_INPUT = BOARD_TABLE_CONTROL;

export function boardFileSelectionError(size: number): string | null {
  return size > MAX_FILE_BYTES
    ? `파일은 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB까지 올릴 수 있어요.`
    : null;
}

/** 헤더/셀 공통 — 첫 열(이름)을 가로 스크롤에서 고정한다. */
// Both frozen edges belong to the shared scrollport at every viewport width.
// 배경은 따로 붙인다 — 머리글 줄은 옅은 틴트(--mw-board-head), 본문은 카드색(#839 · 2026-10-06).
const STICKY_FIRST_BASE = "sticky left-0 z-[var(--mw-layer-board-cell)]";
const STICKY_FIRST = `${STICKY_FIRST_BASE} bg-mw-card`;

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
  if (typeof value === "object") return "";
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
const NEW_LEAD_META_KEYS = new Set(["collaborators", "applied_on"]);

/** 한 셀 — 읽기 전용이면 표시만, 아니면 셀 단위 서버 액션 폼. */
export function BoardCell({
  boardId,
  row,
  column,
  readOnly,
  canonicalNewLead,
  canonicalOwner = false,
  members = [],
  error,
  workflowProgressKind,
  workflowTransitionAction,
  workflowMoveTargets,
  canMoveRows = true,
  consultationEntry,
  consultationMembers,
  cellAction,
  bulkStatusIntercept,
  canCreateColumnOptions,
  addLabelOptionAction,
}: {
  boardId: string;
  row: ItemWithValues;
  column: BoardColumn;
  readOnly: boolean;
  canonicalNewLead?: boolean;
  canonicalOwner?: boolean;
  members?: readonly { id: string; label: string }[];
  error?: string | null;
  workflowProgressKind?: WorkflowProgressKind | null;
  workflowTransitionAction?: ReactNode;
  /** 진행현황 선택지 중 행을 옮기는 것 → 목표 그룹(표시 전용, #839). */
  workflowMoveTargets?: WorkflowStageMoveTargets | null;
  /** #845 — 행을 다른 그룹으로 옮길 권한. false 면 진행현황의 «보드 이동» 선택지가 비활성이다. */
  canMoveRows?: boolean;
  /** 상담 진행 가상 칸의 항목 — 없으면 안내만 그린다(표시 전용, 쓰기 없음). */
  consultationEntry?: ConsultationBoardEntry | null;
  /** 상담 담당자 선택지 — 확인 팝오버의 담당자 목록에 쓴다. */
  consultationMembers?: ReadonlyArray<{ id: string; label: string }>;
  /** 결정론적 화면 검증에서만 저장소 경계를 바꾼다. 실제 셀 폼/제출 흐름은 그대로 둔다. */
  cellAction?: (formData: FormData) => Promise<void>;
  /**
   * 여러 행이 선택된 상태의 낱개 상태 변경을 일괄 흐름으로 넘긴다.
   * true 를 돌려주면 낱개 저장을 건너뛰고 표시값으로 되돌린다.
   */
  bulkStatusIntercept?: (columnKey: string, nextValue: string) => boolean;
  /**
   * 2026-09-26 — «라벨 만들기» 노출 조건. 컬럼 관리 권한이 있을 때만 true 로 넘긴다.
   * 일반 편집자는 검색·선택만 된다(서버도 다시 막는다).
   */
  canCreateColumnOptions?: boolean;
  /** 2026-09-26 — 라벨 만들기 서버 액션. 없으면 만들기 행이 안 보인다. */
  addLabelOptionAction?: (input: AddLabelOptionInput) => Promise<AddLabelOptionResult>;
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
  // 2026-09-26 — «라벨 만들기» 는 권한 + 가드 + 액션이 다 있을 때만 열린다.
  //   보호 컬럼(전이·승인·단계·이동규칙·지역·읽기전용·수식·연동)은 검색·선택만 된다.
  const labelCreatable = canCreateColumnOptions === true
    && typeof addLabelOptionAction === "function"
    && canCreateLabelForColumn(column).allowed;
  const createCellLabel = (label: string) => addLabelOptionAction!({
    boardId,
    columnId: column.id,
    label,
    requestId: newLabelRequestId(),
  });
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
        bulkIntercept={bulkStatusIntercept ? (nextValue) => bulkStatusIntercept(column.key, nextValue) : undefined}
        moveTargets={workflowMoveTargets}
        canMoveRows={canMoveRows}
      />
    );
  }

  // 상담 진행 가상 칸 — 표시 + 그 자리 확인 팝오버 전용. 값을 쓰지 않으므로
  // 일괄 흐름·셀 액션에 넘기지 않는다.
  if (column.key === CONSULTATION_PROGRESS_KEY) {
    return (
      <ConsultationProgressCell
        itemId={row.id}
        title={row.title}
        entry={consultationEntry ? withRowContractFee(consultationEntry, row.values) : null}
        meetingAt={typeof row.values.meeting_at === "string" ? row.values.meeting_at : null}
        assigneeId={typeof row.assigned_to === "string" ? row.assigned_to : null}
        members={consultationMembers ?? []}
        companyName={row.title}
      />
    );
  }

  if (canonicalNewLead && column.key === EXISTING_LOAN_KEYS.amount) {
    return (
      <NewLeadLoanCell
        boardId={boardId}
        itemId={row.id}
        values={row.values}
        readOnly={cellReadOnly}
      />
    );
  }

  if (canonicalNewLead && column.key === NEW_LEAD_COMPOSITE_FIELD_KEYS.creditScores) {
    return (
      <NewLeadCreditScoresCell
        boardId={boardId}
        itemId={row.id}
        ncb={row.values[CREDIT_SCORE_KEYS.ncb]}
        kcb={row.values[CREDIT_SCORE_KEYS.kcb]}
        readOnly={cellReadOnly}
      />
    );
  }

  if (canonicalNewLead && column.key === NEW_LEAD_COMPOSITE_FIELD_KEYS.foundedDate) {
    return (
      <NewLeadFoundedDateCell
        boardId={boardId}
        itemId={row.id}
        value={row.values[NEW_LEAD_COMPOSITE_FIELD_KEYS.foundedDate]}
        readOnly={cellReadOnly}
      />
    );
  }

  if (canonicalNewLead && column.key === NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion) {
    return (
      <NewLeadRevenue3yCell
        boardId={boardId}
        itemId={row.id}
        value={row.values[NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion]}
        legacyRevenueBand={row.values[NEW_LEAD_COMPOSITE_FIELD_KEYS.legacyRevenueBand]}
        years={row.values}
        readOnly={cellReadOnly}
      />
    );
  }

  if (column.type === "other_info") {
    return (
      <OtherInfoBoardCell
        boardId={boardId}
        itemId={row.id}
        fieldKey={column.key}
        value={value}
        legacy={column.key === OTHER_INFO_COLUMN_KEY ? otherInfoLegacyFromValues(row.values) : undefined}
        readOnly={cellReadOnly}
        error={error}
      />
    );
  }

  if ((canonicalNewLead || (row.deal_id && (canonicalOwner || workflowProgressKind === "contact" || workflowProgressKind === "work"))) && column.key === "owner") {
    if (!row.deal_id) {
      return <span title={title} className="block"><StatusCell value={row.assigned_to} options={options} /></span>;
    }
    return (
      <AssignmentLineagePopover
        boardId={boardId}
        dealId={row.deal_id}
        itemId={row.id}
        currentAssigneeId={row.assigned_to}
        members={members}
        readOnly={cellReadOnly}
      />
    );
  }

  if (cellReadOnly) {
    const display =
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
              onChange={(event) => {
                const input = event.currentTarget;
                const error = input.files?.[0]
                  ? boardFileSelectionError(input.files[0].size)
                  : null;
                input.setCustomValidity(error ?? "");
                if (error) {
                  input.reportValidity();
                  input.value = "";
                }
              }}
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
        ) : column.type === "status" ? (
          <LabelCombobox
            options={options}
            value={typeof value === "string" ? value : null}
            name="value"
            label={column.label}
            canCreate={labelCreatable}
            createLabel={labelCreatable ? createCellLabel : undefined}
            interceptChange={bulkStatusIntercept ? (nextValue) => bulkStatusIntercept(column.key, nextValue) : undefined}
            className={`${CELL_INPUT} cursor-pointer`}
          />
        ) : column.type === "select" ? (
          <LabelCombobox
            options={options}
            value={typeof value === "string" ? value : null}
            name="value"
            label={column.label}
            canCreate={labelCreatable}
            createLabel={labelCreatable ? createCellLabel : undefined}
            interceptChange={bulkStatusIntercept ? (nextValue) => bulkStatusIntercept(column.key, nextValue) : undefined}
            className={`${CELL_INPUT} cursor-pointer`}
          />
        ) : column.type === "person" ? (
          <>
            <input type="hidden" name="kind" value="person" />
            <MemberPicker label={column.label} members={members.length > 0 ? members : options.map(({ id, label }) => ({ id, label }))} value={typeof value === "string" ? value : null} multiple={false} compact />
          </>
        ) : column.type === "people" ? (
          <>
            <input type="hidden" name="kind" value="people" />
            <MemberPicker label={column.label} members={members.length > 0 ? members : options.map(({ id, label }) => ({ id, label }))} value={Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []} multiple compact />
          </>
        ) : column.type === "multiselect" ? (
          <LabelCombobox
            options={options}
            value={Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []}
            multiple
            name="value"
            label={column.label}
            canCreate={labelCreatable}
            createLabel={labelCreatable ? createCellLabel : undefined}
            className={CELL_INPUT}
          />
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
  durableDetailColumns = [],
  durableBoardDetailLayout = [],
  durableDetailLayout = [],
  detailLayout = [],
  detailLayoutInherited = true,
  rowDetailLayout,
  rows,
  parentItems = rows,
  readOnly,
  canDeleteItems = !readOnly,
  authorColumnKey,
  viewerUserId,
  canManageColumns = !readOnly,
  addLabelOptionAction,
  rowDragEnabled,
  cellFlash,
  onColumnDrop,
  onColumnKeyboardMove=()=>{},
  dragRowId,
  canDropRow,
  onRowDragStart,
  onRowDragEnd,
  onRowDrop,
  onRowKeyboardMove=()=>{},
  onRowMoveToGroup=()=>{},
  groupMoveOptions=[],
  renderRowAction,
  workflowProgressKind = null,
  workflowMoveTargets = null,
  canMoveRows = true,
  sameTitleCounts,
  renderWorkflowTransition,
  consultationByItem,
  consultationMembers = [],
  renderConsultationSection,
  hideAddRow = false,
  addRowMode = "always",
  addRequest = 0,
  addReturnFocus,
  tablePart = "full",
  textMode = "single",
  focusColumnKey = null,
  onColumnArchived,
  scheduleItems = [],
  scheduleRecipients = [],
  cellAction,
  selection,
  onToggleRow,
  onToggleGroup,
  onBulkStatusRequest,
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
    loadError?: string | null;
    /**
     * 목록이 상한에 걸려 일부만 담겼는가 — 폼이 「없으니 새로 등록하라」고 말하지 않게 한다.
     *
     * ★ «선택» 이 아니라 «필수» 다. 검수에서 이 아래의 전달 한 줄을 지웠더니
     *   325개 테스트가 하나도 안 빨개졌다. 선택이면 빼먹어도 타입이 안 막고,
     *   빼먹으면 잘린 목록에서 「먼저 등록해 주세요」가 그대로 뜬다.
     */
    truncated: boolean;
    action: (
      previous: CompanyIntakeActionState,
      formData: FormData,
    ) => Promise<CompanyIntakeActionState>;
    /**
     * 2026-09-26 — «새 회사» 등록 + 업무 시작. 없으면 새 회사 탭의 제출만 막힌다.
     * 선택으로 두는 이유: 이 prop 을 빼먹으면 타입이 안 막지만, 그때는 제출 버튼이
     * 막혀 조용히 중복을 만들지 않는다(막힌 쪽이 안전하다).
     */
    newCompanyAction?: (
      previous: CompanyIntakeActionState,
      formData: FormData,
    ) => Promise<CompanyIntakeActionState>;
  };
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
  durableDetailColumns?: BoardColumn[];
  durableBoardDetailLayout?: DetailLayoutEntry[];
  durableDetailLayout?: DetailLayoutEntry[];
  detailLayout?: DetailLayoutEntry[];
  detailLayoutInherited?: boolean;
  rowDetailLayout?: (row: ItemWithValues) => { durable: DetailLayoutEntry[]; presented: DetailLayoutEntry[]; inherited: boolean };
  rows: readonly ItemWithValues[];
  parentItems?: readonly { id: string; title: string }[];
  readOnly: boolean;
  canDeleteItems?: boolean;
  /** BBE-239 — 이 키가 있으면 그 컬럼 값이 `viewerUserId` 와 같은 행은 role 권한 없이도 삭제 버튼을 보여준다(작성자 예외, 공지사항 한정). 서버가 다시 검증한다 — 여긴 표시 전용. */
  authorColumnKey?: string;
  viewerUserId?: string;
  canManageColumns?: boolean;
  /** 2026-09-26 — 라벨 만들기 서버 액션. 셀 드롭다운의 만들기 행이 이걸 쓴다. */
  addLabelOptionAction?: (input: AddLabelOptionInput) => Promise<AddLabelOptionResult>;
  /** 정렬이 켜져 있으면 부모가 false 를 준다 — 손잡이 자체를 감춰 헛짚을 자리를 없앤다. */
  rowDragEnabled: boolean;
  cellFlash: CellFlash | null;
  onColumnDrop: (draggedKey: string, targetKey: string) => void;
  onColumnKeyboardMove?:(columnKey:string,delta:-1|1)=>void;
  /** 지금 끌고 있는 행 id(다른 그룹의 행일 수 있다) — **표시 전용**. 없으면 null. */
  dragRowId: string | null;
  /** 드롭을 받아도 되는지의 **판정**. 리렌더 타이밍과 무관하게 부모 ref 를 즉시 읽는다. */
  canDropRow: () => boolean;
  onRowDragStart: (itemId: string) => void;
  onRowDragEnd: () => void;
  /** 이 그룹의 index 위치에 놓는다. */
  onRowDrop: (index: number) => void;
  onRowKeyboardMove?:(rowId:string,direction:"up"|"down")=>void;
  onRowMoveToGroup?:(rowId:string,groupId:string|null)=>void;
  groupMoveOptions?:readonly {id:string;name:string}[];
  renderRowAction?: (row: ItemWithValues) => ReactNode;
  /** 화면의 통합 진행현황 셀. 실제 저장은 기존 단계/이동 계약을 그대로 소비한다. */
  workflowProgressKind?: WorkflowProgressKind | null;
  /** 진행현황 선택지 → 목표 그룹. 원본 단계 컬럼의 이동 규칙에서 만든 표시 전용 맵(#839). */
  workflowMoveTargets?: WorkflowStageMoveTargets | null;
  /**
   * #845 — 행을 다른 그룹으로 옮길 권한(보드의 canMoveRows). 정렬·저장 중 같은 «지금 못 끄는»
   * 상태가 아니라 권한만 뜻한다 — 진행현황 값으로 옮기는 것은 정렬과 무관하다.
   */
  canMoveRows?: boolean;
  /**
   * 계약업체 실무 전용 — 보드에 보이는 행 중 같은 제목(=회사명)이 몇 건인지.
   * 2건 이상이면 제목 옆에 «같은 회사 N건» 을 단다(표시 전용, 데이터·제목은 그대로).
   */
  sameTitleCounts?: ReadonlyMap<string, number>;
  renderWorkflowTransition?: (row: ItemWithValues) => ReactNode;
  /**
   * 상담 단계 보기 적재분(item id → 항목). 있으면 «상담 진행» 가상 칸과
   * 상세 인라인에 쓴다. 없으면 그 칸들을 그리지 않는다(기존 보드 그대로).
   */
  consultationByItem?: ConsultationBoardMap;
  /** 상담 담당자 선택지 — 확인 팝오버·상세 인라인의 담당자 목록에 쓴다. */
  consultationMembers?: ReadonlyArray<{ id: string; label: string }>;
  /** 행 상세에 얹는 상담 확인 인라인 — 업무이동 메뉴 없이 상세에서 바로 확인한다. */
  renderConsultationSection?: (row: ItemWithValues) => ReactNode;
  /** 상담 단계 보기(가상 계약 단계 묶음)에서는 새 행 추가 줄을 감춘다. */
  hideAddRow?: boolean;
  /**
   * 2026-10-08 대표 결정 — 「업체 추가」 를 보드마다 늘어놓지 않는다.
   * "on-demand" 면 추가 줄의 펼침 단추를 그리지 않고, 도구줄의 「＋ 업체 추가」·배너의 ＋ 가
   * `addRequest` 를 올릴 때만 입력 패널을 연다. 기본("always")은 지금까지처럼 늘 보인다.
   */
  addRowMode?: "always" | "on-demand";
  /** 0 보다 크고 바뀔 때마다 이 그룹의 추가 패널을 연다("on-demand" 전용). */
  addRequest?: number;
  /** 추가 패널을 닫으면 포커스를 돌려줄 곳 — 패널을 연 머리말·배너 단추. */
  addReturnFocus?: () => HTMLElement | null;
  /**
   * 2026-10-08 대표 결정 — 제목행은 보드 맨 위 하나만 두고 내려가도 따라오게 한다.
   *   · "head": 제목행만 그린다(BoardWorkspace 가 맨 위에 한 번).
   *   · "body": 제목행은 보조기기용 이름만 남기고(높이 0) 행만 그린다.
   *   · "full": 지금까지처럼 그룹마다 제목행(그룹마다 열 구성이 다를 때·단독 사용).
   * "head"/"body" 는 고정 폭 표(table-layout: fixed)라 모든 표의 열이 같은 자리에 선다.
   */
  tablePart?: "full" | "head" | "body";
  textMode?: "single" | "wrap";
  focusColumnKey?: string | null;
  onColumnArchived?: (columnId: string) => void;
  scheduleItems?: readonly ColumnScheduleItemOption[];
  scheduleRecipients?: readonly ColumnScheduleRecipientOption[];
  cellAction?: (formData: FormData) => Promise<void>;
  /**
   * 일괄 선택 — BoardWorkspace 가 들고 있는 공유 집합. 없으면 체크박스를 그리지 않는다.
   * 첫 칸(이름) 안에 들어 sticky 와 단일 가로 스크롤을 그대로 유지한다.
   * 표준 체크박스(키보드 접근 가능)를 유지하고 Shift-클릭은 보이는 순서 구간으로 넓힌다.
   */
  selection?: ReadonlySet<string>;
  onToggleRow?: (itemId: string, checked: boolean, shiftKey?: boolean) => void;
  /** 이 그룹의 보이는 행 전체를 같은 상태로. */
  onToggleGroup?: (checked: boolean) => void;
  /**
   * 여러 행이 선택된 채 그중 하나의 상태값을 건드리면 낱개로 바꾸지 않고
   * 일괄 흐름을 연다 (값은 되돌려 둔다).
   * 실제 의도한 컬럼 키를 그대로 전달한다 — 상태 의도가 아니면 false 를 돌려
   * 그 칸이 스스로 편집되게 한다.
   */
  onBulkStatusRequest?: (rowId: string, columnKey: string, presetValue: string) => boolean;
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
  const [invalidColKey,setInvalidColKey]=useState<string|null>(null);
  const [overRowIndex, setOverRowIndex] = useState<number | null>(null);
  const [invalidRowIndex,setInvalidRowIndex]=useState<number|null>(null);
  const [dropMessage,setDropMessage]=useState<string|null>(null);

  const clearColDrag = useCallback(() => {
    dragColRef.current = null;
    setDragColKey(null);
    setOverColKey(null);
    setInvalidColKey(null);
  },[]);

  const clearRowDrop=useCallback(()=>{
    setOverRowIndex(null);
    setInvalidRowIndex(null);
  },[]);

  useEffect(()=>{
    const clearAll=()=>{
      dragColRef.current=null;
      setDragColKey(null);
      setOverColKey(null);
      setInvalidColKey(null);
      clearRowDrop();
      onRowDragEnd();
    };
    window.addEventListener("dragend",clearAll);
    return()=>window.removeEventListener("dragend",clearAll);
  },[clearRowDrop,onRowDragEnd]);

  const colSpan = columns.length + 1;
  // 그룹 마스터 — 보이는 행 기준 3상태. indeterminate 는 ref 로, 접근성은 aria-checked 로.
  const groupTriState = selection && onToggleGroup
    ? selectionTriState(selection, rows.map((row) => row.id))
    : "empty";
  const bulkArmed = (selection?.size ?? 0) > 1;
  // 시도-시군구 의존 콤보 — 같은 보드에 두 키가 함께 있을 때만 쌍으로 저장한다.
  const regionSidoKey = columns.find((column) => isRegionSidoKey(column.key))?.key ?? null;
  const regionSigunguKey = columns.find((column) => isRegionSigunguKey(column.key))?.key ?? null;
  const regionPairKeys = regionSidoKey && regionSigunguKey ? { sidoKey: regionSidoKey, sigunguKey: regionSigunguKey } : null;
  const regionSidoColumn = regionPairKeys ? columns.find((column) => column.key === regionPairKeys.sidoKey) ?? null : null;
  const regionSigunguColumn = regionPairKeys ? columns.find((column) => column.key === regionPairKeys.sigunguKey) ?? null : null;
  /*
   * 지역 쌍 읽기전용 판정 — BoardCell 과 같은 답을 양쪽에 동일하게 적용한다.
   * 원자 저장이라 한쪽만 잠그면 의미가 없다: 어느 한쪽이라도 손으로 못 고치면
   * 쌍 전체를 표시만 한다. 서버도 setCellsStrict 재검증으로 같은 답을 낸다.
   */
  const isRegionPairReadOnly = (): boolean => {
    if (readOnly || !regionSidoColumn || !regionSigunguColumn) return true;
    return [regionSidoColumn, regionSigunguColumn].some((column) =>
      !isSourceEditable(column.source) || column.is_readonly === true,
    );
  };

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
  // 맨 위 제목행과 그룹마다의 표가 끄는 동안의 폭을 같이 본다(column-live-width).
  const { widths: liveWidths, set: setLiveWidth } = useLiveColumnWidths(boardId);

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
      setLiveWidth(r.columnId, r.current);
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
  }, [commitWidth, setLiveWidth]);

  /**
   * #845 — 업체명(첫 번째·고정) 열 폭. 사람별·보드별 내 화면 설정(브라우저 저장)이라
   * 관리자 권한 없이 누구나 조절한다. 그룹마다 표가 따로라도 같은 저장소를 구독해 함께 움직인다.
   */
  const titleColumn = useTitleColumnWidth(boardId, currentUserId);
  const titleResizeRef = useRef<{ startX: number; startWidth: number; current: number; moved: boolean } | null>(null);
  const { preview: previewTitleWidth, commit: commitTitleWidth } = titleColumn;
  useEffect(() => {
    function onMove(e: PointerEvent | MouseEvent) {
      const r = titleResizeRef.current;
      if (!r) return;
      if (!r.moved && Math.abs(e.clientX - r.startX) < 2) return;
      r.moved = true;
      r.current = clampTitleWidth(r.startWidth + (e.clientX - r.startX));
      previewTitleWidth(r.current);
    }
    function onUp() {
      const r = titleResizeRef.current;
      titleResizeRef.current = null;
      // 누르기만 하고 움직이지 않았으면 저장하지 않는다(지금 폭을 고정해 버리지 않게).
      if (r?.moved) commitTitleWidth(r.current);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [commitTitleWidth, previewTitleWidth]);
  const startTitleResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest("th");
    const startWidth = th ? th.getBoundingClientRect().width : TITLE_COLUMN_MIN;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    titleResizeRef.current = { startX: e.clientX, startWidth, current: startWidth, moved: false };
  };
  const nudgeTitleWidth = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    const th = e.currentTarget.closest("th");
    const current = titleColumn.width ?? (th ? th.getBoundingClientRect().width : TITLE_COLUMN_MIN);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      commitTitleWidth(current + (e.key === "ArrowRight" ? TITLE_COLUMN_STEP : -TITLE_COLUMN_STEP));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      commitTitleWidth(e.key === "Home" ? TITLE_COLUMN_MIN : TITLE_COLUMN_MAX);
    }
  };
  // 폭은 CSS 변수로만 넘기고 실제 적용은 globals.css 의 640px 이상 규칙이 한다(휴대폰 고정 열 상한 유지).
  const titleCellStyle = titleColumn.width
    ? ({ "--mw-title-width": `${titleColumn.width}px` } as React.CSSProperties)
    : undefined;
  const titleWidthAttr = titleColumn.width ? String(titleColumn.width) : undefined;

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
    setLiveWidth(columnId, null);
    commitWidth(columnId, null);
  };

  /*
   * 2026-10-08 대표 결정 — 제목행은 보드 맨 위 하나("head"), 행은 그룹마다("body").
   * 두 표가 다른 <table> 이므로 둘 다 고정 폭 표로 그리고 같은 폭 계산을 쓴다 —
   * 그래야 모든 그룹의 열이 맨 위 제목 아래 같은 자리에 선다. 이름 열은 사람별 폭이 있으면
   * globals.css(640px 이상)가, 없으면 기본 폭 클래스가 정한다(휴대폰 8rem 상한은 그대로).
   */
  const fixedLayout = tablePart !== "full";
  // 첫 열 이름 — 계약업체 실무는 목업대로 「업체」(한 줄이 «어느 업체의 자금 건» 이다).
  const titleLabel = canonicalNewLead ? "회사명" : workflowProgressKind === "work" ? "업체" : "이름";
  // 2026-10-08 — 「업체 추가」 는 머리말 단추·배너 ＋ 에서만 연다. 닫혀 있으면 추가 줄은 그룹 끝 드롭 자리만
  // 남는다 — 평소엔 얇은 띠, 행을 끄는 동안엔 한 줄 높이(그룹 맨 끝에 놓을 수 있게).
  const onDemandAdd = addRowMode === "on-demand" && Boolean(companyPicker) && !(canonicalNewLead && groupId);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const columnWidth = (col: BoardColumn): number | undefined =>
    fixedLayout ? fixedColumnWidth(col, liveWidths[col.id]) : liveWidths[col.id] ?? col.width ?? undefined;
  const tableStyle: React.CSSProperties | undefined = fixedLayout
    ? {
      tableLayout: "fixed",
      width: `${(titleColumn.width ?? TITLE_COLUMN_DEFAULT) + columns.reduce((sum, col) => sum + (columnWidth(col) ?? 0), 0)}px`,
      minWidth: "100%",
    }
    : undefined;
  const titleWidthClass = fixedLayout && !titleColumn.width ? "w-44" : "";

  const acceptRow = (index: number) => (e: React.DragEvent) => {
    if (!rowDragEnabled || !canDropRow()) {setOverRowIndex(null);setInvalidRowIndex(index);setDropMessage("이 보기에서는 행을 옮길 수 없어요.");return;}
    if(rows[index]?.id===dragRowId){setOverRowIndex(null);setInvalidRowIndex(index);setDropMessage("같은 행 위에는 놓을 수 없어요.");return;}
    e.preventDefault();
    e.dataTransfer.dropEffect="move";
    setInvalidRowIndex(null);
    setOverRowIndex(index);
    setDropMessage("이 위치로 이동합니다.");
  };

  const dropRow = (index: number) => (e: React.DragEvent) => {
    if (!rowDragEnabled || !canDropRow()||rows[index]?.id===dragRowId){clearRowDrop();setDropMessage("이 위치에는 놓을 수 없어요.");return;}
    e.preventDefault();
    setOverRowIndex(null);
    onRowDrop(index);
  };

  return (
    <div
      data-board-table-format="uniform"
      data-board-table-part={tablePart === "full" ? undefined : tablePart}
      className={tablePart === "head"
        ? "sticky top-0 z-[var(--mw-layer-board-corner)] min-w-0 rounded-md border border-mw-line bg-mw-board-head"
        : "relative isolate max-h-[70vh] min-w-0 max-w-full overflow-auto"}
    >
      <p className="sr-only" aria-live="polite">{dropMessage}</p>
      <table
        className={`${fixedLayout ? "" : "w-full "}border-collapse text-left`}
        style={tableStyle}
        aria-label={tablePart === "head" ? "열 제목" : undefined}
      >
        {tablePart === "body" ? (
          /* 제목은 맨 위 표에 있다 — 여기는 보조기기가 칸 이름을 읽을 수 있게 이름만, 높이 0 으로 둔다.
             첫 칸·우측 고정 칸은 화면 표와 똑같이 sticky 다(공유 스크롤의 고정 열 계약 #759). */
          <thead data-board-head-labels="">
            <tr>
              <th
                scope="col"
                className={`${STICKY_FIRST_BASE} h-0 border-0 p-0 ${titleWidthClass}`}
                style={titleCellStyle}
                data-board-title-column
                data-title-width={titleWidthAttr}
              >
                <span className="sr-only">{titleLabel}</span>
              </th>
              {columns.map((col) => {
                const width = columnWidth(col);
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={`h-0 border-0 p-0 ${col.rightPinned ? "sticky right-0" : ""}`}
                    style={width ? { width, minWidth: width } : undefined}
                    data-column-key={col.key}
                    data-right-pinned={col.rightPinned || undefined}
                  >
                    <span className="sr-only">{col.label}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
        ) : (
        <thead>
          <tr>
            <th
              scope="col"
              className={`${STICKY_FIRST_BASE} z-[var(--mw-layer-board-corner)] bg-mw-board-head ${BOARD_TABLE_HEADER_CELL} min-w-44 ${titleWidthClass}`}
              style={{ top: 0, position: "sticky", ...titleCellStyle }}
              data-board-title-column
              data-title-width={titleWidthAttr}
            >
              <span className="flex items-center gap-1">
                {selection && onToggleGroup ? (
                  <input
                    ref={(element) => { if (element) element.indeterminate = groupTriState === "partial"; }}
                    type="checkbox"
                    checked={groupTriState === "full"}
                    aria-checked={groupTriState === "partial" ? "mixed" : undefined}
                    aria-label={tablePart === "head" ? "보이는 행 전체 선택" : `${groupName ?? "그룹"} 전체 선택`}
                    onChange={(event) => onToggleGroup(event.currentTarget.checked)}
                    className="h-3.5 w-3.5 shrink-0"
                    data-no-drag
                  />
                ) : null}
                {canonicalNewLead ? (
                  <><SourceBadge source="auto" />회사명</>
                ) : titleLabel}
              </span>
              <span
                role="separator"
                aria-orientation="vertical"
                aria-label={`${canonicalNewLead ? "회사명" : titleLabel} 열 폭 조절 · 좌우 화살표로 조절, 두 번 누르면 원래대로`}
                aria-valuemin={TITLE_COLUMN_MIN}
                aria-valuemax={TITLE_COLUMN_MAX}
                aria-valuenow={titleColumn.width ?? TITLE_COLUMN_DEFAULT}
                tabIndex={0}
                data-no-drag
                data-board-title-resize
                draggable={false}
                onPointerDown={startTitleResize}
                onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); titleColumn.reset(); }}
                onKeyDown={nudgeTitleWidth}
                title="끌어서 폭 조절 · 두 번 누르면 원래대로"
                className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize border-r-2 border-transparent transition-colors hover:border-mw-record focus-visible:border-mw-record focus-visible:outline-none"
              />
            </th>
            {columns.map((col) => {
              const isTarget = overColKey === col.key && dragColKey !== col.key;
              const width = columnWidth(col);
              const workflowLocked = col.key === WORKFLOW_PROGRESS_KEY;
              const presentationOnlyStructure = canonicalNewLead
                && isNewLeadPresentationOnlyStructure(col);
              const structureLocked = workflowLocked || presentationOnlyStructure;
              return (
                <th
                  key={col.id}
                  scope="col"
                  draggable={canManageColumns && !structureLocked}
                   onDragStart={(event) => {
                     if (structureLocked) return;
                     if((event.target as HTMLElement).closest("button,input,select,textarea,a,[role=menu],[contenteditable=true],[data-no-drag]")){event.preventDefault();setOverColKey(null);return;}
                     claimBoardTransientSurface(`board:${boardId}`,`column-drag:${boardId}`);
                    dragColRef.current = col.key;
                    setDragColKey(col.key);
                  }}
                  onDragEnd={clearColDrag}
                   onDragOver={(e) => {
                     if (structureLocked) {setOverColKey(null);setInvalidColKey(col.key);setDropMessage("이 컬럼은 구조를 바꿀 수 없어요.");return;}
                    if (!dragColRef.current) return;
                    if(dragColRef.current===col.key){setOverColKey(null);setInvalidColKey(col.key);setDropMessage("같은 컬럼 위치에는 놓을 수 없어요.");return;}
                    e.preventDefault();
                    setInvalidColKey(null);
                    setOverColKey(col.key);
                  }}
                  onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){if(overColKey===col.key)setOverColKey(null);if(invalidColKey===col.key)setInvalidColKey(null);}}}
                  onDrop={(e) => {
                    if (structureLocked) {clearColDrag();return;}
                    const dragged = dragColRef.current;
                    if (!dragged) return;
                    e.preventDefault();
                    if (dragged !== col.key) onColumnDrop(dragged, col.key);
                    clearColDrag();
                  }}
                  title={
                    !canManageColumns || structureLocked
                      ? cellTitle(col)
                      : `${cellTitle(col)} — 끌어서 ${tablePart === "head" ? "" : "이 그룹의 "}컬럼 순서 변경`
                  }
                  style={width ? { width, minWidth: width } : undefined}
                  data-view-focus={col.key === focusColumnKey || undefined}
                  data-column-key={col.key}
                  data-right-pinned={col.rightPinned || undefined}
                   className={`relative sticky top-0 z-[var(--mw-layer-board-header)] min-w-20 ${BOARD_TABLE_HEADER_CELL} ${col.key === focusColumnKey ? "bg-mw-tint-blue" : col.rightPinned ? "bg-mw-tint-blue" : "bg-mw-board-head"} ${
                    !canManageColumns || structureLocked
                      ? ""
                      : "cursor-grab active:cursor-grabbing"
                  } ${isTarget ? "bg-mw-tint-blue text-mw-record" : ""} ${
                    invalidColKey===col.key?"cursor-not-allowed":""
                  } ${
                    dragColKey === col.key ? "opacity-50" : ""
                  } ${col.rightPinned ? "right-0 text-mw-record" : ""}`}
                >
                  <span className="flex items-center gap-1">
                    {canManageColumns && !structureLocked ? (
                      <ColumnContextMenu
                        boardId={boardId}
                        column={col}
                        scheduleItems={scheduleItems}
                        scheduleRecipients={scheduleRecipients}
                        onArchived={onColumnArchived}
                      >
                        <SourceBadge source={col.source} />
                         <BoardInlineTitleEditor name={col.label} label="컬럼 이름" onSave={(value)=>renameColumnTitleAction(boardId,col.id,value)} className="min-w-0 flex-1 truncate"/>
                      </ColumnContextMenu>
                    ) : (
                      <>
                        <SourceBadge source={col.source} />
                        <span className="truncate">{col.label}</span>
                      </>
                    )}
                  </span>
                  {canManageColumns && !structureLocked && (
                    <span
                      aria-hidden="true"
                      data-no-drag
                      draggable={false}
                      onMouseDown={startResize(col.id)}
                      onDoubleClick={resetWidth(col.id)}
                      title="끌어서 폭 조절 · 두 번 누르면 원래대로"
                      /*
                       * #655 ② — 모서리 슬롭 제거.
                       *
                       * 전에는 `w-1.5 hover:bg-mw-record/40` 이라, 올리면 «6px 파란 덩어리» 가 떴다.
                       * 평소의 컬럼 구분선은 1px 인데 그보다 여섯 배 굵고, 구분선보다 왼쪽으로
                       * 어긋나 있고, `top-0 h-full` 이 테두리를 빼고 재서 셀 아래까지 닿지도 않았다.
                       * 모서리에 «자리를 못 잡은 덩어리» 가 하나 생기는 것으로 보인다.
                       *
                       * ★ 잡는 영역은 6px 그대로 둔다 — 1px 를 겨누게 만들면 못 잡는다.
                       *   바꾸는 것은 «보이는 것» 뿐이다: 오른쪽 끝에 2px 선으로, 구분선 위에 정확히 겹치게.
                       * ★ top-0 h-full → inset-y-0. 그래야 테두리까지 포함한 셀 «전체» 높이가 된다.
                       */
                      className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize border-r-2 border-transparent transition-colors hover:border-mw-record"
                    />
                  )}
                  {canManageColumns&&!structureLocked?<span className="sr-only focus-within:not-sr-only">
                    <button type="button" onClick={()=>onColumnKeyboardMove(col.key,-1)} aria-label={`${col.label} 왼쪽으로 이동`}>왼쪽으로 이동</button>
                    <button type="button" onClick={()=>onColumnKeyboardMove(col.key,1)} aria-label={`${col.label} 오른쪽으로 이동`}>오른쪽으로 이동</button>
                  </span>:null}
                </th>
              );
            })}
          </tr>
        </thead>
        )}

        {tablePart === "head" ? null : (
        <tbody>
          {rows.length === 0 && (
            /* 원칙 5 — 빈 상태는 표 안 1줄. 동시에 첫 행의 드롭 자리이기도 하다. */
            <tr onDragOver={acceptRow(0)} onDragLeave={()=>clearRowDrop()} onDrop={dropRow(0)}>
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
            // 이 행이 여러 선택에 포함돼 있으면 낱개 상태 변경 대신 일괄 흐름을 연다.
            const resolvedRowDetail = rowDetailLayout?.(row);
            const armedForRow = bulkArmed && (selection?.has(row.id) ?? false) && onBulkStatusRequest;
            return (
              <tr
                key={row.id}
                data-board-row=""
                onDragOver={acceptRow(index)}
                onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)&&overRowIndex===index)clearRowDrop();}}
                onDrop={dropRow(index)}
                className={`group ${BOARD_TABLE_ROW} hover:bg-mw-bg ${
                  dragRowId === row.id ? "opacity-40" : ""
                } ${overRowIndex === index ? "border-t-2 border-t-mw-record bg-mw-tint-blue" : ""} ${invalidRowIndex===index?"cursor-not-allowed":""}`}
              >
                <td
                  draggable={rowDragEnabled}
                  onDragStart={rowDragEnabled?(event)=>{
                    if((event.target as HTMLElement).closest("button,input,select,textarea,a,[role=menu],[contenteditable=true],[data-no-drag]")){event.preventDefault();clearRowDrop();setDropMessage("편집 중인 컨트롤에서는 끌 수 없어요.");return;}
                    claimBoardTransientSurface(`board:${boardId}`,`row-drag:${boardId}`);
                    event.dataTransfer.effectAllowed="move";onRowDragStart(row.id);
                  }:undefined}
                  onDragEnd={()=>{onRowDragEnd();clearRowDrop();setDropMessage(null);}}
                  className={`${STICKY_FIRST} ${BOARD_TABLE_BODY_CELL} group-hover:bg-mw-bg ${rowDragEnabled?"cursor-grab active:cursor-grabbing":""}`}
                  style={titleCellStyle}
                  data-board-title-cell
                  data-title-width={titleWidthAttr}
                >
                  <div className="flex items-center gap-1">
                    {selection && onToggleRow ? (
                      <input
                        type="checkbox"
                        checked={selection.has(row.id)}
                        aria-label={`${row.title} 선택`}
                        onChange={(event) => {
                          const native = event.nativeEvent as MouseEvent | KeyboardEvent | undefined;
                          const shift = typeof (native as { shiftKey?: unknown } | undefined)?.shiftKey === "boolean"
                            ? (native as { shiftKey: boolean }).shiftKey
                            : false;
                          onToggleRow(row.id, event.currentTarget.checked, shift);
                        }}
                        className="h-3.5 w-3.5 shrink-0"
                        data-no-drag
                      />
                    ) : null}

                    {readOnly ? (
                      <span className="truncate text-[length:var(--fs-13)] font-semibold text-mw-fg">
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
                            className={BOARD_TABLE_TITLE_CONTROL}
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

                    {(sameTitleCounts?.get(row.title) ?? 0) >= 2 ? (
                      <span
                        data-same-company-count={sameTitleCounts?.get(row.title)}
                        title="이 보드에 같은 회사 이름의 건이 여러 개 있어요. 회사 1곳의 자금 건이 여러 개일 수 있습니다."
                        className="shrink-0 whitespace-nowrap rounded-full border border-mw-line bg-mw-board-head px-1.5 text-[length:var(--fs-11)] leading-5 text-mw-sub"
                      >
                        같은 회사 {sameTitleCounts?.get(row.title)}건
                      </span>
                    ) : null}

                    <ItemDetailPanel
                      boardId={boardId}
                      boardName={boardName}
                      groupName={groupName}
                      consultationSection={renderConsultationSection?.(row)}
                      row={row}
                      parentItemTitle={parentItems.find((candidate) => candidate.id === row.parent_item_id)?.title}
                      columns={detailColumns}
                      boardLayout={boardDetailLayout}
                      durableColumns={durableDetailColumns}
                      durableBoardLayout={durableBoardDetailLayout}
                      durableLayout={resolvedRowDetail?.durable ?? durableDetailLayout}
                      layout={resolvedRowDetail?.presented ?? detailLayout}
                      inherited={resolvedRowDetail?.inherited ?? detailLayoutInherited}
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

                    {/* BBE-240 원장 버튼은 2026-10-07 대표 피드백으로 상세(열기) 머리말로 옮겼다 — 행은 이름·열기·삭제만. */}

                    {canDeleteRow && (
                      <TrashItemButton
                        boardId={boardId}
                        itemId={row.id}
                        title={row.title}
                      />
                    )}
                    {rowDragEnabled?<span className="sr-only focus-within:not-sr-only">
                      <button type="button" onClick={()=>onRowKeyboardMove(row.id,"up")} aria-label={`${row.title} 위로 이동`}>위로 이동</button>
                      <button type="button" onClick={()=>onRowKeyboardMove(row.id,"down")} aria-label={`${row.title} 아래로 이동`}>아래로 이동</button>
                      <label><span>그룹으로 이동</span><select aria-label={`${row.title} 이동할 그룹`} defaultValue="" onChange={(event)=>{if(event.target.value)onRowMoveToGroup(row.id,event.target.value);event.currentTarget.value="";}}><option value="">그룹 선택</option>{groupMoveOptions.filter((group)=>group.id!==groupId).map((group)=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                    </span>:null}
                  </div>
                  {renderRowAction?.(row)}
                </td>

                {columns.map((col) => {
                  const isRegionCell = Boolean(
                    regionPairKeys && (isRegionSidoKey(col.key) || isRegionSigunguKey(col.key)),
                  );
                  return (
                    <td
                      key={col.id}
                      data-view-focus={col.key === focusColumnKey || undefined}
                      data-column-key={col.key}
                      data-right-pinned={col.rightPinned || undefined}
                      className={`${BOARD_TABLE_BODY_CELL} group-hover:bg-mw-bg ${(col.wrap_mode ?? textMode) === "wrap" ? "whitespace-normal break-words" : "max-w-80 truncate whitespace-nowrap"} ${col.key === focusColumnKey ? "bg-mw-tint-blue" : ""} ${
                        col.rightPinned
                          ? "sticky right-0 z-[var(--mw-layer-board-cell)]"
                          : ""
                      }`}
                    >
                      {isRegionCell && regionPairKeys ? (
                        <RegionCell
                          boardId={boardId}
                          itemId={row.id}
                          dealId={row.deal_id}
                          canonicalNewLead={canonicalNewLead}
                          kind={isRegionSidoKey(col.key) ? "sido" : "sigungu"}
                          sidoKey={regionPairKeys.sidoKey}
                          sigunguKey={regionPairKeys.sigunguKey}
                          sidoValue={String(
                            row.values[regionPairKeys.sidoKey] ?? row.values.sido ?? row.values.region_sido ?? "",
                          )}
                          sigunguValue={String(
                            row.values[regionPairKeys.sigunguKey] ?? row.values.sigungu ?? row.values.region_sigungu ?? "",
                          )}
                          readOnly={isRegionPairReadOnly()}
                        />
                      ) : (
                        <BoardCell
                          boardId={boardId}
                          row={row}
                          column={col}
                          readOnly={readOnly}
                          canonicalNewLead={canonicalNewLead}
                          bulkStatusIntercept={armedForRow
                            ? (columnKey, nextValue) => {
                              const handler = onBulkStatusRequest;
                              if (!handler) return false;
                              return handler(row.id, columnKey, nextValue);
                            }
                            : undefined}
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
                          workflowMoveTargets={workflowMoveTargets}
                          canMoveRows={canMoveRows}
                          consultationEntry={consultationByItem?.[row.id] ?? null}
                          consultationMembers={consultationMembers}
                          cellAction={cellAction}
                          canCreateColumnOptions={canManageColumns}
                          addLabelOptionAction={addLabelOptionAction}
                        />
                      )}
                    </td>
                  );
                })}


              </tr>
            );
          })}

          {!readOnly && !hideAddRow && (
            /* 마지막 줄 = 새 항목 입력 + 그룹 맨 끝 드롭 자리(원칙 5). */
            <tr
              onDragOver={acceptRow(rows.length)}
              onDragLeave={()=>clearRowDrop()}
              onDrop={dropRow(rows.length)}
            >
              {/*
                추가 줄은 표 너비 전체를 쓴다(colSpan) — 펼친 접수 패널이 이름 열 폭(#845 사람별 폭)에
                눌려 찌그러지지 않고, 패널을 열어도 다른 행의 이름 열 폭이 바뀌지 않는다.
              */}
              <td colSpan={columns.length + 1} className={`${STICKY_FIRST} ${onDemandAdd && !addPanelOpen ? (dragRowId ? "h-9 p-0" : "h-2 p-0") : "px-2 py-1"} ${overRowIndex === rows.length ? "bg-mw-tint-blue" : ""}`}>
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
                    loadError={companyPicker.loadError}
                    truncated={companyPicker.truncated}
                    startWorkAction={companyPicker.action}
                    startNewCompanyWorkAction={companyPicker.newCompanyAction}
                    boardId={boardId}
                    // 누른 그룹을 그대로 넘긴다 — 이 값이 없으면 서버가 첫 그룹에 넣는다(#588).
                    groupId={groupId}
                    inputClassName={`${CELL_INPUT} w-full max-w-md`}
                    trigger={onDemandAdd ? "none" : "inline"}
                    openRequest={onDemandAdd ? addRequest : 0}
                    onOpenChange={setAddPanelOpen}
                    returnFocusTarget={onDemandAdd ? addReturnFocus : undefined}
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
        )}
      </table>
    </div>
  );
}
