"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 컬럼 폭을 끄는 동안의 «화면 값»(D12). 저장은 놓을 때 한 번 board_columns.width 로 나간다.
 *
 * 2026-10-08 대표 결정 — 제목행을 보드 맨 위 하나로 합쳤다. 그러면 끄는 손잡이는 맨 위 표에
 * 있고 행은 그룹마다 다른 표에 있으므로, 끄는 동안의 폭도 모든 표가 같이 봐야 줄이 맞는다.
 * 그래서 표마다 들고 있던 state 를 보드별 모듈 저장소 하나로 옮겼다(title-column-width 와 같은 방식).
 */
type Widths = Readonly<Record<string, number>>;

const EMPTY: Widths = Object.freeze({});
const listeners = new Set<() => void>();
const store = new Map<string, Widths>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 테스트 전용 — 모듈 저장소를 비운다. */
export function resetLiveColumnWidthsForTest(): void {
  store.clear();
}

export function useLiveColumnWidths(boardId: string) {
  const widths = useSyncExternalStore(
    subscribe,
    () => store.get(boardId) ?? EMPTY,
    () => EMPTY,
  );
  /** null 이면 화면 값을 지워 저장된 폭(또는 기본 폭)으로 돌아간다. */
  const set = useCallback((columnId: string, width: number | null) => {
    const next = { ...(store.get(boardId) ?? EMPTY) };
    if (width === null) delete next[columnId];
    else next[columnId] = width;
    store.set(boardId, next);
    for (const listener of listeners) listener();
  }, [boardId]);
  return { widths, set };
}
