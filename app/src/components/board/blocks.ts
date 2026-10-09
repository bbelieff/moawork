import { NEW_LEAD_GROUPS } from "@/lib/default-tabs/new-lead";
import { NEW_LEAD_STAGE_LABELS, newLeadStageOf } from "@/lib/new-lead/stage-presentation";
/**
 * 탭 페이지 = **블록 리스트** (PLAN-002 WO-2 ⓔ · 사용자 방향 확정 2026-08-04).
 *
 * 화면은 "그룹들의 나열"이 아니라 "블록들의 나열"이다. 이번 릴리스에 존재하는 블록은
 * 아이템 블록(= 탭 안의 그룹) 하나뿐이지만, 렌더러가 처음부터 `kind` 로 분기하기 때문에
 * PLAN-003 의 노션형 삽입(노트·이미지·링크 블록)은 **여기에 variant 를 추가하는 것만으로**
 * 얹힌다 — 표 컴포넌트를 다시 쓰지 않아도 된다.
 *
 * ⚠ 용어: MoaWork 에서 **아이템 = 탭 안의 그룹**이다(먼데이 API 의 item(행)과 다르다).
 * 행은 `ItemWithValues` 지만 화면 어휘로는 "행", 블록 단위는 "아이템(그룹)"이다.
 */

import type { BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import { toStatusChip } from "@/lib/boards/status-palette";
import { GROUP_NONE_LABEL, groupValueOf, type AssignmentOwnerMode } from "@/lib/view/group-by";
import { groupKeyOf, UNGROUPED_KEY } from "./layout";

/** 아이템(그룹) 블록 — 색 헤더 밴드 + 표 하나. */
export interface ItemGroupBlock {
  kind: "item-group";
  /** 블록 식별자 = 그룹 키(그룹 없음은 UNGROUPED_KEY). */
  key: string;
  /** 003 board_groups 행. 가상 "그룹 없음" 블록은 null. */
  group: BoardGroup | null;
  /** 화면 표시 이름. */
  name: string;
  /** 헤더 밴드 색(hex) — 미지정이면 null 이고 렌더러가 중립색으로 그린다. */
  color: string | null;
  rows: ItemWithValues[];
  /**
   * #845 7단계 — 나눠 보기(칸 값별 묶음)일 때만 있다. 이 묶음이 뜻하는 칸과 값(null = 「(없음)」),
   * 띠 색(목록·상태 칸은 선택지 색, 사람·없음은 null = 중립색).
   */
  groupValue?: GroupValueSection;
}

export interface GroupValueSection {
  columnKey: string;
  /** 선택지 id 또는 계정 id. null = 값 없음(「(없음)」). */
  id: string | null;
  accent: string | null;
}

/**
 * 블록 유니언. PLAN-003 에서 아래로 늘어난다:
 *   | NoteBlock | ImageBlock | LinkBlock
 */
export type BoardBlock = ItemGroupBlock;

/**
 * 그룹 + 행 → 블록 리스트.
 *
 * - 블록 순서 = 그룹의 sort_order (003 board_groups)
 * - 행 순서 = 아이템의 sort_order (드래그로 갱신)
 * - 그룹 없는 행이 하나라도 있으면 맨 뒤에 "그룹 없음" 블록을 만든다.
 *   행이 없으면 만들지 않는다 — 빈 가상 블록은 원칙 2(목적 없는 공백 금지) 위반이다.
 */
export function buildBlocks(
  groups: readonly BoardGroup[],
  rows: readonly ItemWithValues[],
): BoardBlock[] {
  const byGroup = new Map<string, ItemWithValues[]>();
  for (const row of rows) {
    const key = groupKeyOf(row.group_id);
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(row);
    else byGroup.set(key, [row]);
  }
  for (const bucket of byGroup.values()) {
    bucket.sort((a, b) => a.sort_order - b.sort_order);
  }

  const blocks: BoardBlock[] = [...groups]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((group) => ({
      kind: "item-group" as const,
      key: group.id,
      group,
      name: group.name,
      color: group.color,
      rows: byGroup.get(group.id) ?? [],
    }));

  const orphans = byGroup.get(UNGROUPED_KEY);
  if (orphans && orphans.length > 0) {
    blocks.push({
      kind: "item-group",
      key: UNGROUPED_KEY,
      group: null,
      name: "그룹 없음",
      color: null,
      rows: orphans,
    });
  }
  return blocks;
}

/** Status view only: keep physical IDs/layouts and preserve unknown/legacy rows in their original blocks. */
export function buildNewLeadStageBlocks(groups: readonly BoardGroup[], rows: readonly ItemWithValues[]): BoardBlock[] {
  const stageRows = new Map<string, ItemWithValues[]>();
  const remaining: ItemWithValues[] = [];
  for (const row of rows) {
    const stage = newLeadStageOf(row);
    if (!stage) { remaining.push(row); continue; }
    const bucket = stageRows.get(stage) ?? [];
    bucket.push(row); stageRows.set(stage, bucket);
  }
  const stages: BoardBlock[] = NEW_LEAD_STAGE_LABELS.map((stage, index) => ({
    kind: "item-group", key: `new-lead-stage:${index}`, group: null, name: stage,
    color: null, rows: [...(stageRows.get(stage) ?? [])].sort((a,b) => a.sort_order-b.sort_order),
  }));
  return [...stages, ...buildBlocks(groups, remaining).filter((block) => block.rows.length > 0 || (block.group && !Object.values(NEW_LEAD_GROUPS).some((name) => name === block.group?.name)))];
}

/** Virtual headings never become persistence keys. Reuse the original physical group's layout. */
export function durableNewLeadBlockKey(block: BoardBlock, groups: readonly BoardGroup[]): string {
  return block.group?.id ?? block.rows.find((row) => row.group_id)?.group_id ?? groups[0]?.id ?? UNGROUPED_KEY;
}

/** 값 묶음 블록 키 — 같은 칸·같은 값이면 같은 키(접힘·추가 패널 상태가 묶음을 따라간다). */
export function valueBlockKey(columnKey: string, id: string | null): string {
  return id === null ? `value:${columnKey}::none` : `value:${columnKey}:${id}`;
}

/**
 * #845 7단계 — 나눠 보기: 모든 보드의 행을 한 칸의 값별 묶음으로 다시 나눈다.
 *
 * - 묶음 순서: 목록·상태 칸은 선택지 순서, 사람 칸은 구성원 순서. 선택지·구성원에 없는 값(옛 값·나간
 *   사람)은 숨기지 않고 그 뒤에 따로 묶는다. 값이 없는 행은 맨 끝 「(없음)」.
 * - 빈 묶음도 만든다(끌어 놓을 자리) — 화면이 접어 둔다.
 * - 묶음 안의 행 순서: 보드 순서 → 보드 안 순서(sort_order). 정렬이 걸리면 화면이 그 순서로 다시 세운다.
 * - 물리 그룹·순서·이동 규칙은 건드리지 않는다(group 은 null — 보드 띠가 아니다).
 */
export function buildValueBlocks({
  column,
  groups,
  rows,
  members = [],
  memberLabels = {},
  ownerMode = "never",
}: {
  column: Pick<BoardColumn, "key" | "type" | "options_jsonb">;
  groups: readonly BoardGroup[];
  rows: readonly ItemWithValues[];
  /** 사람 칸의 묶음 순서 — 조직 구성원(사람 선택기와 같은 목록). */
  members?: readonly { id: string; label: string }[];
  /** 구성원 목록에 없는 계정 id 의 표시 이름. */
  memberLabels?: Readonly<Record<string, string>>;
  ownerMode?: AssignmentOwnerMode;
}): BoardBlock[] {
  const groupRank = new Map([...groups].sort((a, b) => a.sort_order - b.sort_order).map((group, index) => [group.id, index]));
  const rank = (row: ItemWithValues) => (row.group_id === null ? groups.length : groupRank.get(row.group_id) ?? groups.length);
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order);

  const buckets = new Map<string | null, ItemWithValues[]>();
  const seenOrder: string[] = [];
  for (const row of ordered) {
    const value = groupValueOf(column, row, ownerMode);
    const bucket = buckets.get(value);
    if (bucket) bucket.push(row);
    else {
      buckets.set(value, [row]);
      if (value !== null) seenOrder.push(value);
    }
  }

  const isOption = column.type === "select" || column.type === "status";
  const options = isOption ? column.options_jsonb?.options ?? [] : [];
  const known: { id: string; label: string; accent: string | null }[] = isOption
    ? options.map((option) => ({ id: option.id, label: option.label, accent: toStatusChip(option.id, options).background }))
    : members.map((member) => ({ id: member.id, label: member.label, accent: null }));
  const knownIds = new Set(known.map((entry) => entry.id));
  const unknown = seenOrder
    .filter((id) => !knownIds.has(id))
    .map((id) => ({ id, label: isOption ? id : memberLabels[id] || "이름 없는 사람", accent: null }));

  const block = (id: string | null, label: string, accent: string | null): BoardBlock => ({
    kind: "item-group",
    key: valueBlockKey(column.key, id),
    group: null,
    name: label,
    color: null,
    rows: buckets.get(id) ?? [],
    groupValue: { columnKey: column.key, id, accent },
  });
  return [
    ...[...known, ...unknown].map((entry) => block(entry.id, entry.label, entry.accent)),
    block(null, GROUP_NONE_LABEL, null),
  ];
}
