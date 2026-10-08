"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

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
/** 보드별로 이 저장소를 쓰는 표의 수. 마지막 표가 내려가면(보드 화면을 떠나면) 그 보드의 끄는 값을 버린다. */
const users = new Map<string, number>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 테스트 전용 — 모듈 저장소를 비운다. */
export function resetLiveColumnWidthsForTest(): void {
  store.clear();
  users.clear();
}

export function useLiveColumnWidths(boardId: string) {
  // 보드를 떠났다 오면 저장된 폭(board_columns.width)을 다시 따른다 — 저장이 실패했거나 다른 사람이 바꾼
  // 폭을 이 탭의 옛 끄는 값이 가리지 않게.
  useEffect(() => {
    users.set(boardId, (users.get(boardId) ?? 0) + 1);
    return () => {
      const left = (users.get(boardId) ?? 1) - 1;
      if (left > 0) users.set(boardId, left);
      else {
        users.delete(boardId);
        store.delete(boardId);
      }
    };
  }, [boardId]);
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
