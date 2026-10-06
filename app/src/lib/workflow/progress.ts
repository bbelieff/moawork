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
    transitionLabel: "상담관리로 넘기기",
    targetLabel: "상담관리",
    targetHref: "/contract",
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

/**
 * 진행현황 선택지 → 그 선택이 행을 옮겨 갈 그룹.
 * `accent` 는 그 그룹의 톤 색(CSS 토큰, #845) — 선택지 점·칩이 그룹 띠와 같은 색이 되게 한다.
 */
export type WorkflowStageMoveTarget = Readonly<{ groupId: string; groupName: string; accent?: string | null }>;
export type WorkflowStageMoveTargets = ReadonlyMap<string, WorkflowStageMoveTarget>;

/**
 * 2026-10-06 — 진행현황 선택지 중 «행을 다른 그룹으로 옮기는» 것 (#839 · #845).
 *
 * 화면용 진행현황 열은 move_rule_jsonb 를 비운다(위 presentWorkflowProgressColumns —
 * 검색·일괄 판정이 그 열을 쓰므로 비운 채로 둔다). 그래서 «원본» 단계 컬럼의 규칙에서
 * 읽는다. 표시 전용이다 — 실제 이동은 지금처럼 서버의 setCells 가 같은 규칙으로 정한다.
 *
 * 규칙이 가리키는 그룹이 이 보드에 «없으면» 이동 대상에서 뺀다(#845 검토 후속). 서버도 그 경우
 * 행을 옮기지 않고 값만 저장하므로, 화면도 그 선택지를 «상태만 바꾸기» 로 보여 줘야 같은 답이다.
 * (전에는 «보드 이동 → 다른 그룹» 으로 보였지만 실제로는 행이 움직이지 않았다.)
 */
export function workflowStageMoveTargets(
  kind: WorkflowProgressKind,
  rawColumns: readonly BoardColumn[],
  groups: readonly Readonly<{ id: string; name: string; accent?: string | null }>[],
): WorkflowStageMoveTargets {
  const stage = rawColumns.find((column) => column.key === workflowProgressSpec(kind).stageColumnKey);
  const rule = stage?.move_rule_jsonb;
  const targets = new Map<string, WorkflowStageMoveTarget>();
  if (!rule) return targets;
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const [optionId, groupId] of Object.entries(rule)) {
    if (typeof groupId !== "string" || groupId === "") continue;
    const group = byId.get(groupId);
    if (!group) continue;
    targets.set(optionId, { groupId, groupName: group.name, accent: group.accent ?? null });
  }
  return targets;
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
