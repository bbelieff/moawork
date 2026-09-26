/**
 * 일괄 적용 순수 게이트 — `bulk-actions.ts`(`"use server"`)에서 분리.
 *
 * Next `"use server"` 파일은 async 함수만 export 할 수 있다.
 * 순수 헬퍼·상수를 같은 파일에 두면 서버 액션 로더가 통째로 죽는다
 * (`check-use-server-exports.mjs` 게이트). 그래서 판정은 여기 둔다.
 */

import {
  WORKFLOW_PROGRESS_KEY,
  workflowProgressSpec,
  type WorkflowProgressKind,
} from "@/lib/workflow/progress";
import {
  BULK_BLOCKED_COLUMN_KEYS,
  BULK_BLOCKED_VALUES,
  bulkBlockReasonFor,
} from "@/components/board/bulk-selection";
import { isSourceEditable } from "@/lib/field/source";
import type { BoardColumn } from "@/lib/boards/types";

export { BULK_BLOCKED_COLUMN_KEYS, BULK_BLOCKED_VALUES };

export type BulkStatusColumnPick = {
  key: string;
  label: string;
  options: { id: string; label: string }[];
  /**
   * 실제 물리 컬럼 id — 일괄 대화상자의 «만들기»는 이게 있을 때만 잇는다.
   * 없으면 검색 전용이다(셀 드롭다운에서만 만든다).
   */
  columnId: string | null;
};

/**
 * 일괄 상태 컬럼 선택 — 물리 컬럼에서 찾는다.
 * `presentWorkflowProgressColumns` 가 표(tableColumns)의 단계 키를 합성
 * `workflow_progress` 로 바꾸므로 표에서 찾으면 주요 탭이 전부 null 이 된다.
 * 화면 합성(진행현황 라벨·전이값 제외)은 그대로 보존한다.
 */
export function pickBulkStatusColumn(
  physicalColumns: readonly BoardColumn[],
  workflowKind: WorkflowProgressKind | null,
): BulkStatusColumnPick | null {
  const pick = (key: string) => physicalColumns.find((column) => column.key === key);
  const found = workflowKind
    ? pick(workflowProgressSpec(workflowKind).stageColumnKey)
    : (physicalColumns.find((column) => column.type === "status")
      ?? physicalColumns.find((column) => column.type === "select"));
  if (!found || !isSourceEditable(found.source) || found.is_readonly === true) return null;
  const transitionValue = workflowKind
    ? workflowProgressSpec(workflowKind).transitionValue
    : null;
  const options = (found.options_jsonb?.options ?? [])
    .filter((option) => option.id !== transitionValue && !BULK_BLOCKED_VALUES.has(option.id))
    .map((option) => ({ id: option.id, label: option.label }));
  if (options.length === 0) return null;
  return {
    key: found.key,
    label: workflowKind ? "진행현황" : found.label,
    options,
    columnId: found.id,
  };
}

/**
 * 낱개 상태 변경을 일괄로 넘길지 판정 — 실제 의도한 컬럼 키를 본다.
 * 상태 의도가 아니면 false (그 칸이 스스로 편집된다).
 */
export function isBulkStatusIntent(
  columnKey: string,
  workflowKind: WorkflowProgressKind | null,
  statusColumnKey: string | null,
): boolean {
  if (workflowKind) {
    try {
      const stageKey = workflowProgressSpec(workflowKind).stageColumnKey;
      return columnKey === WORKFLOW_PROGRESS_KEY || columnKey === stageKey;
    } catch {
      return false;
    }
  }
  return statusColumnKey !== null && columnKey === statusColumnKey;
}

export type BulkInterceptDecision = "status" | "fields" | "single";

/**
 * 여러 건이 선택된 채 낱개 셀을 건드렸을 때의 분기 — 실제 컬럼 키를 보존한다.
 *  - 1개 이하 선택·미선택 행 편집은 낱개(single) 그대로 둔다.
 *  - 주력 상태(진행현황·단계)는 status 일괄로.
 *  - 비주력 select/status는 실제 키·값으로 fields 일괄을 연다.
 */
export function decideBulkIntercept(input: {
  selectedSize: number;
  isSelectedRow: boolean;
  columnKey: string;
  workflowKind: WorkflowProgressKind | null;
  statusColumnKey: string | null;
  fieldColumns: readonly { key: string; type: string }[];
}): BulkInterceptDecision {
  if (input.selectedSize <= 1) return "single";
  if (!input.isSelectedRow) return "single";
  if (isBulkStatusIntent(input.columnKey, input.workflowKind, input.statusColumnKey)) return "status";
  const field = input.fieldColumns.find((entry) => entry.key === input.columnKey);
  if (field && (field.type === "select" || field.type === "status")) return "fields";
  return "single";
}

/**
 * 화면의 합성 진행현황 키를 실제 저장 컬럼으로 되돌린다.
 * 합성 키로 쓰면 EAV 오염(정의되지 않은 컬럼 무시 → 조용한 미저장)이 된다.
 */
export function resolveBulkColumnKey(
  columnKey: string,
  workflowKind: WorkflowProgressKind | null,
): string {
  if (columnKey === WORKFLOW_PROGRESS_KEY && workflowKind) {
    return workflowProgressSpec(workflowKind).stageColumnKey;
  }
  return columnKey;
}

/** 차단 사유 — null 이면 일괄 허용 후보 (서비스 검증은 별도로 돈다). */
export function bulkBlockReason(
  columnKey: string,
  value: unknown,
  workflowKind: WorkflowProgressKind | null,
): string | null {
  const resolved = resolveBulkColumnKey(columnKey, workflowKind);
  const transitionValue =
    workflowKind && resolved === workflowProgressSpec(workflowKind).stageColumnKey
      ? workflowProgressSpec(workflowKind).transitionValue
      : null;
  return bulkBlockReasonFor(resolved, value, transitionValue);
}
