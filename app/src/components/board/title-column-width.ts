"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * #845 (대표 요청 2026-10-06) — 업체명(첫 번째·고정) 열의 좌우 폭.
 *
 * 다른 컬럼 폭은 관리자가 정하는 «보드 공유 값»(board_columns.width)이지만, 이름 열은
 * 사람마다 화면이 달라 «내 화면 설정» 으로 둔다: 사람(계정)별·보드별로 이 브라우저에 저장한다.
 * 폭은 640px 이상 화면에서만 적용한다(globals.css) — 휴대폰의 고정 열 상한(8rem)을 지킨다.
 * DB 를 바꾸지 않으므로 누구나(구성원 포함) 조절할 수 있다.
 *
 * 그룹마다 표가 따로 그려지므로 모든 표가 같은 폭을 쓰도록 모듈 단위 저장소 하나를
 * useSyncExternalStore 로 구독한다. 저장소 접근은 사생활 모드 등에서 실패할 수 있어 늘 감싼다.
 */
export const TITLE_COLUMN_MIN = 160;
export const TITLE_COLUMN_MAX = 560;
export const TITLE_COLUMN_STEP = 16;
/** 저장값이 없을 때의 기본 폭(min-w-44) — 보조기기에 알리는 현재값으로만 쓴다. */
export const TITLE_COLUMN_DEFAULT = 176;
const KEY_PREFIX = "mw:board-title-width:";

const listeners = new Set<() => void>();
const memory = new Map<string, number | null>();

export function clampTitleWidth(value: number): number {
  return Math.round(Math.min(TITLE_COLUMN_MAX, Math.max(TITLE_COLUMN_MIN, value)));
}

function read(boardId: string): number | null {
  if (memory.has(boardId)) return memory.get(boardId) ?? null;
  let value: number | null = null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + boardId);
    const parsed = raw === null ? Number.NaN : Number(raw);
    value = Number.isFinite(parsed) ? clampTitleWidth(parsed) : null;
  } catch {
    value = null;
  }
  memory.set(boardId, value);
  return value;
}

function write(boardId: string, value: number | null, persist: boolean): void {
  memory.set(boardId, value);
  if (persist) {
    try {
      if (value === null) window.localStorage.removeItem(KEY_PREFIX + boardId);
      else window.localStorage.setItem(KEY_PREFIX + boardId, String(value));
    } catch {
      // 저장이 막혀도 이번 화면에서는 조절한 폭을 그대로 쓴다.
    }
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 테스트 전용 — 모듈 저장소를 비운다. */
export function resetTitleColumnWidthStoreForTest(): void {
  memory.clear();
}

export function useTitleColumnWidth(boardId: string, userId?: string | null) {
  const key = `${boardId}:${userId ?? "anon"}`;
  const width = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  /** 끄는 동안 — 화면만 바꾸고 저장하지 않는다. */
  const preview = useCallback((value: number) => write(key, clampTitleWidth(value), false), [key]);
  /** 놓았을 때·키보드 조절 — 저장한다. */
  const commit = useCallback((value: number) => write(key, clampTitleWidth(value), true), [key]);
  /** 두 번 누르기 — 기본 폭으로 되돌린다. */
  const reset = useCallback(() => write(key, null, true), [key]);
  return { width, preview, commit, reset };
}
