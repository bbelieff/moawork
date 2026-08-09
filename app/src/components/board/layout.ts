/**
 * 그룹별 컬럼 배치 오버라이드 — 순수 계산부 (PLAN-002 WO-2 ⓑ).
 *
 * 핵심 규약: **컬럼 정의(board_columns)는 보드 전역으로 유지하고, 배치·노출만 그룹별로
 * 오버라이드한다.** 오버라이드가 컬럼을 만들거나 지우지 않기 때문에 셀 데이터(EAV,
 * item_values.column_key)는 배치를 아무리 바꿔도 그대로 남는다 — WO-2 가 요구하는
 * "그룹 간 독립 배치 + 셀 데이터 무결성"이 이 한 가지 설계에서 나온다.
 *
 * 그래서 오버라이드는 컬럼 **id 가 아니라 key** 의 배열로 저장한다. key 는 보드 안에서
 * 유일하고(003 board_columns.key ← item_values.column_key), 컬럼을 지웠다 같은 이름으로
 * 다시 만들어도 배치가 살아남는다.
 *
 * 오버라이드는 **부분 목록**이어도 된다. 목록에 없는 컬럼은 보드 기본 순서(sort_order)
 * 그대로 뒤에 이어 붙는다 — 컬럼이 새로 추가돼도 그룹 배치를 다시 저장할 필요가 없고,
 * 삭제된 컬럼의 잔재는 조용히 무시된다(고아 key 로 표가 깨지지 않는다).
 */

import type { BoardColumn } from "@/lib/boards/types";

/** 그룹이 없는 아이템(group_id = null)들이 모이는 가상 그룹의 키. */
export const UNGROUPED_KEY = "__ungrouped__";

/** 그룹 키 ← group_id. null 은 가상 그룹으로 수렴. */
export function groupKeyOf(groupId: string | null): string {
  return groupId ?? UNGROUPED_KEY;
}

/** 그룹 키 → 컬럼 key 배열. 저장소·직렬화 양쪽에서 쓰는 형태. */
export type GroupColumnOrder = Record<string, string[]>;

/**
 * 오버라이드를 보드 기본 순서에 겹쳐 그룹의 최종 컬럼 순서를 만든다.
 *
 * - 오버라이드에 있고 보드에도 있는 컬럼 → 오버라이드 순서대로 앞에
 * - 오버라이드에 없는 컬럼 → 보드 기본 순서대로 뒤에
 * - 오버라이드에만 있는 key(삭제된 컬럼) → 무시
 *
 * 결과 길이는 항상 `columns.length` 이고, 원소는 항상 `columns` 의 원소다.
 */
export function resolveColumnOrder(
  columns: readonly BoardColumn[],
  override: readonly string[] | undefined,
): BoardColumn[] {
  if (!override || override.length === 0) return [...columns];

  const byKey = new Map(columns.map((c) => [c.key, c]));
  const ordered: BoardColumn[] = [];
  const taken = new Set<string>();

  for (const key of override) {
    const col = byKey.get(key);
    // 삭제된 컬럼의 잔재와 중복 key 를 여기서 걸러낸다.
    if (!col || taken.has(key)) continue;
    ordered.push(col);
    taken.add(key);
  }
  for (const col of columns) {
    if (!taken.has(col.key)) ordered.push(col);
  }
  return ordered;
}

/**
 * `from` 위치의 원소를 `to` 위치로 옮긴 새 배열. 원본은 건드리지 않는다.
 * 범위를 벗어난 인덱스는 그대로 복사본을 돌려준다(드롭 실패를 예외로 만들지 않는다).
 */
export function moveWithin<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to) return next;
  if (from < 0 || from >= next.length) return next;
  if (to < 0 || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 컬럼 key 하나를 다른 key 자리로 끌어다 놓은 결과(= 그 그룹의 새 오버라이드).
 * 반환값은 **전체 컬럼 key 목록**이라 저장 시점의 배치가 그대로 재현된다.
 */
export function reorderColumnKeys(
  columns: readonly BoardColumn[],
  draggedKey: string,
  targetKey: string,
): string[] {
  const keys = columns.map((c) => c.key);
  return moveWithin(keys, keys.indexOf(draggedKey), keys.indexOf(targetKey));
}
