/**
 * 그룹 ↔ 진행현황 단계 연결 — 2026-10-06 제품 책임자 결정(#845).
 *
 * «단계 = 보드 그룹». 띠(그룹)의 이름을 바꾸거나 순서를 바꾸거나 그룹을 더하면 진행현황의 단계 목록이
 * 저절로 따라온다. 그래서 행을 보낼 때 «어느 단계가 어느 띠인가» 를 따로 외우지 않아도 된다.
 *
 * 어느 보드의 어느 칸이 연결돼 있는지, 그리고 설치기·서비스가 같은 눈으로 동기화 계획을 세우는
 * 도우미를 여기 모은다. 실제 계산은 순수 함수 `syncGroupLinkedStageColumn`(./moveRules.ts) 이다.
 * (default-tabs/ 최상위 .ts 는 qa-app 이 «탭 정의» 로 읽으므로 이 도우미는 여기 둔다.)
 *
 * 계약업체 실무만 연결한다. 리드컨택은 이동 규칙이 «담당자» 를 다시 배정하고, 신규리드의 상담 단계
 * 정본은 deals 라서 «그룹 = 단계» 가 다른 뜻이 된다 — 별도 결정 전에는 넣지 않는다.
 */

import type { BoardColumn } from "./types";
import {
  stageSyncNeedsLiveRowCounts,
  syncGroupLinkedStageColumn,
  type StageSyncGroup,
  type StageSyncSettings,
} from "./moveRules";
import type { FieldOption } from "@/lib/types";
import { CONTRACT_WORK_TAB, CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";

/** 연결된 단계 칸을 손으로 고치려 할 때의 안내 — 서버가 막고 화면이 그대로 보여 준다. */
export const LINKED_STAGE_EDIT_MESSAGE = "진행현황 단계는 보드 이름·순서를 바꾸면 함께 바뀌어요";

const LINKED_STAGE_COLUMN_BY_SOURCE: ReadonlyMap<string, string> = new Map([
  [CONTRACT_WORK_TAB_SOURCE, "progress_status"],
]);

const INSTALLER_GROUP_NAMES_BY_SOURCE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [CONTRACT_WORK_TAB_SOURCE, new Set(CONTRACT_WORK_TAB.groups.map((group) => group.name))],
]);

/** 이 보드에서 그룹과 연결된 단계 칸 key — 연결된 보드가 아니면 null. */
export function groupLinkedStageColumnKey(source: string | null | undefined): string | null {
  return source ? LINKED_STAGE_COLUMN_BY_SOURCE.get(source) ?? null : null;
}

type LinkedColumnHead = Pick<BoardColumn, "key" | "type" | "move_rule_jsonb">;

/**
 * 이 칸이 «그룹과 연결된 단계 칸» 인가 — 연결된 보드의 그 key 이고, 단일 선택이며, 이동 규칙이 켜져 있다.
 * 규칙이 비었으면 회사가 이동을 끈 것으로 읽는다(설치기 backfill 과 같은 눈) — 그때는 연결하지 않는다.
 */
export function isGroupLinkedStageColumn(source: string | null | undefined, column: LinkedColumnHead): boolean {
  const key = groupLinkedStageColumnKey(source);
  return key !== null
    && column.key === key
    && (column.type === "select" || column.type === "status")
    && Boolean(column.move_rule_jsonb && Object.keys(column.move_rule_jsonb).length > 0);
}

function settingsFor(source: string | null | undefined): StageSyncSettings {
  const names = source ? INSTALLER_GROUP_NAMES_BY_SOURCE.get(source) : undefined;
  return names ? { installerGroupNames: names } : {};
}

export type LinkedStageSyncPatch = Readonly<{
  columnId: string;
  options: FieldOption[];
  moveRule: Record<string, string>;
}>;

type SyncColumn = Pick<BoardColumn, "id" | "key" | "type" | "move_rule_jsonb" | "options_jsonb">;

/** 동기화 계획에 행 수가 필요한가(빈 설치기 복제 후보가 있을 때만). 필요 없으면 행을 읽지 않는다. */
export function linkedStageSyncNeedsLiveRowCounts(
  source: string | null | undefined,
  columns: readonly SyncColumn[],
  groups: readonly StageSyncGroup[],
): boolean {
  const key = groupLinkedStageColumnKey(source);
  const column = key ? columns.find((candidate) => candidate.key === key) : undefined;
  if (!column || !isGroupLinkedStageColumn(source, column)) return false;
  return stageSyncNeedsLiveRowCounts(groups, settingsFor(source));
}

/**
 * 연결된 단계 칸에 쓸 것 — 바뀔 것이 없거나 연결된 보드·칸이 아니면 null(쓰지 않는다).
 * `liveRowCounts` 가 없으면 «증거» 로만 판단한다(syncGroupLinkedStageColumn 참고).
 */
export function planLinkedStageSync(
  source: string | null | undefined,
  columns: readonly SyncColumn[],
  groups: readonly StageSyncGroup[],
  liveRowCounts?: ReadonlyMap<string, number>,
): LinkedStageSyncPatch | null {
  const key = groupLinkedStageColumnKey(source);
  const column = key ? columns.find((candidate) => candidate.key === key) : undefined;
  if (!column || !isGroupLinkedStageColumn(source, column)) return null;
  const plan = syncGroupLinkedStageColumn(column, groups, liveRowCounts, settingsFor(source));
  if (!plan || !plan.changed) return null;
  return { columnId: column.id, options: plan.options, moveRule: plan.moveRule };
}

/** 행 목록 → 그룹별 살아 있는 행 수(휴지통·보관 제외). */
export function countLiveRowsByGroup(
  items: readonly { group_id: string | null; deleted_at?: string | null; archived_at?: string | null }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.group_id === null || item.deleted_at || item.archived_at) continue;
    counts.set(item.group_id, (counts.get(item.group_id) ?? 0) + 1);
  }
  return counts;
}
