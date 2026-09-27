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

import type { BoardGroup, ItemWithValues } from "@/lib/boards/types";
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
