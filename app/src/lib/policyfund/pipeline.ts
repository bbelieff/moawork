// T09 · 파이프라인 단계별 필터·정렬(순수 로직).
//
// 보드 아이템을 특정 상태 컬럼(예: 계약상황/진행상항)의 셀 값 기준으로
// 필터링·정렬한다. 단계(옵션) 목록의 SSOT 는 002_seed 이므로, 단계 순서는
// 호출부가 옵션 순서(PresetOption.order/배열 순서)로 주입한다 — 하드코딩 금지.

import type { BoardItem } from "./types";

/** 특정 상태 컬럼 값이 stage 인 아이템만 남긴다. */
export function filterByStage(
  items: readonly BoardItem[],
  columnId: string,
  stage: string,
): BoardItem[] {
  return items.filter((it) => it.cells[columnId] === stage);
}

/**
 * 아이템을 단계 순서(stageOrder)대로 정렬한다.
 * stageOrder 에 없는 값(미지정/기타)은 뒤로 보낸다. 안정 정렬.
 */
export function sortByStage(
  items: readonly BoardItem[],
  columnId: string,
  stageOrder: readonly string[],
): BoardItem[] {
  const rank = new Map(stageOrder.map((s, i) => [s, i]));
  const at = (it: BoardItem): number => {
    const v = it.cells[columnId];
    const r = typeof v === "string" ? rank.get(v) : undefined;
    return r ?? Number.MAX_SAFE_INTEGER;
  };
  // index 를 곁들여 동순위 안정성 보장.
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => at(a.it) - at(b.it) || a.i - b.i)
    .map((x) => x.it);
}

/** 단계별 아이템 개수 집계(파이프라인 요약). */
export function countByStage(
  items: readonly BoardItem[],
  columnId: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const v = it.cells[columnId];
    if (typeof v === "string") out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

/**
 * 단계 순서대로 그룹화한 보드(칸반) 구조.
 * 각 단계별 아이템 배열 — 빈 단계도 키로 포함(먼데이 그룹 재현).
 */
export function groupByStage(
  items: readonly BoardItem[],
  columnId: string,
  stageOrder: readonly string[],
): { stage: string; items: BoardItem[] }[] {
  return stageOrder.map((stage) => ({
    stage,
    items: filterByStage(items, columnId, stage),
  }));
}
