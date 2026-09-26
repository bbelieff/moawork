import { presentNewLeadStageColumn } from "@/lib/new-lead/stage-presentation";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";

export const WORKFLOW_PROGRESS_KEY = "workflow_progress";

export type WorkflowProgressKind = "new-lead" | "contact" | "work";

export type WorkflowProgressSpec = Readonly<{
  kind: WorkflowProgressKind;
  stageColumnKey: string;
  legacyMoveColumnKey: string | null;
  transitionValue: string | null;
  transitionLabel: string;
  targetLabel: string;
  targetHref: string;
  guardLabel: string | null;
}>;

const SPECS: Readonly<Record<WorkflowProgressKind, WorkflowProgressSpec>> = {
  "new-lead": {
    kind: "new-lead",
    stageColumnKey: "consult_status",
    legacyMoveColumnKey: "contact_move",
    transitionValue: "리드컨택으로 넘기기",
    transitionLabel: "비대면 상담으로 넘기기",
    targetLabel: "비대면 상담",
    targetHref: "/consult-remote",
    guardLabel: null,
  },
  contact: {
    kind: "contact",
    stageColumnKey: "contract_status",
    legacyMoveColumnKey: "work_move",
    transitionValue: "업무관리 이동",
    transitionLabel: "계약업체 실무로 넘기기",
    targetLabel: "계약업체 실무",
    targetHref: "/work",
    guardLabel: "직인 완료",
  },
  work: {
    kind: "work",
    stageColumnKey: "progress_status",
    legacyMoveColumnKey: null,
    transitionValue: null,
    transitionLabel: "업체관리 현황에서 보기",
    targetLabel: "업체관리 현황",
    targetHref: "/companies",
    guardLabel: null,
  },
};

export function workflowKindForSource(source: string | null): WorkflowProgressKind | null {
  if (source === NEW_LEAD_TAB_SOURCE) return "new-lead";
  if (source === CONTACT_TAB_SOURCE) return "contact";
  if (source === CONTRACT_WORK_TAB_SOURCE) return "work";
  return null;
}

export function workflowProgressSpec(kind: WorkflowProgressKind): WorkflowProgressSpec {
  return SPECS[kind];
}

/**
 * 저장된 두 컬럼을 지우거나 합치지 않는다. 화면에서만 한 칸으로 투영해 과거 값과
 * 자동화 계약을 보존하고, 사용자는 하나의 «진행현황»만 보게 한다.
 */
export function presentWorkflowProgressColumns(
  kind: WorkflowProgressKind,
  columns: readonly BoardColumn[],
): BoardColumn[] {
  const spec = workflowProgressSpec(kind);
  const stage = columns.find((column) => column.key === spec.stageColumnKey);
  if (!stage) return [...columns];

  const stageOptions = stage.options_jsonb?.options ?? [];
  const visibleOptions = spec.transitionValue
    ? stageOptions.filter((option) => option.id !== spec.transitionValue)
    : stageOptions;
  const hidden = new Set([spec.stageColumnKey, spec.legacyMoveColumnKey].filter(Boolean));
  const ordinary = columns.filter((column) => !hidden.has(column.key));
  const progress: BoardColumn = {
    ...stage,
    id: `${stage.id}:workflow-progress`,
    key: WORKFLOW_PROGRESS_KEY,
    label: "진행현황",
    rightPinned: true,
    width: Math.max(stage.width ?? 0, 180),
    options_jsonb: { ...stage.options_jsonb, options: visibleOptions },
    move_rule_jsonb: null,
  };
  return [...ordinary.filter((column) => !column.rightPinned), kind === "new-lead" ? presentNewLeadStageColumn(progress) : progress];
}

export function withWorkflowProgressValues(
  kind: WorkflowProgressKind,
  rows: readonly ItemWithValues[],
): ItemWithValues[] {
  const stageKey = workflowProgressSpec(kind).stageColumnKey;
  return rows.map((row) => ({
    ...row,
    values: {
      ...row.values,
      [WORKFLOW_PROGRESS_KEY]: row.values[stageKey] ?? null,
    },
  }));
}

export function workflowDetailHiddenKeys(kind: WorkflowProgressKind): ReadonlySet<string> {
  const spec = workflowProgressSpec(kind);
  return new Set(
    [WORKFLOW_PROGRESS_KEY, spec.stageColumnKey, spec.legacyMoveColumnKey]
      .filter((key): key is string => typeof key === "string"),
  );
}
