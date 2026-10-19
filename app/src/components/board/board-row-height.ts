"use client";

/**
 * 보드 행 높이 — 2026-10-19 belie «업체당 셀 높이를 한 줄로, 아래 테두리를 끌어 늘리면 전체가 같이,
 * 두 번 누르면 기본으로».
 *
 * 사람·보드별 내 화면 설정이다(브라우저 저장). 그룹마다 표가 따로라도 같은 저장소를 구독해 함께 움직인다.
 * 행 높이는 «최소 높이» 다 — 오류 문구처럼 내용이 더 크면 그 행만 더 커진다(내용을 숨기지 않는다).
 */
import { useSyncExternalStore } from "react";

export const ROW_HEIGHT_DEFAULT = 34;
export const ROW_HEIGHT_MIN = 28;
export const ROW_HEIGHT_MAX = 160;

const listeners = new Set<() => void>();
const memory = new Map<string, number>();
const storageKey = (boardId: string) => `mw:board-row-height:${boardId}`;

export function clampRowHeight(px: number): number {
  return Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, Math.round(px)));
}

function read(boardId: string): number {
  if (memory.has(boardId)) return memory.get(boardId)!;
  let value = ROW_HEIGHT_DEFAULT;
  try {
    const stored = Number(window.localStorage.getItem(storageKey(boardId)));
    if (Number.isFinite(stored) && stored > 0) value = clampRowHeight(stored);
  } catch {
    // 저장소를 못 쓰면(사생활 모드 등) 기본 높이로 둔다.
  }
  memory.set(boardId, value);
  return value;
}

export function setBoardRowHeight(boardId: string, px: number | null, persist = true): void {
  const value = px === null ? ROW_HEIGHT_DEFAULT : clampRowHeight(px);
  memory.set(boardId, value);
  if (persist) {
    try {
      if (px === null) window.localStorage.removeItem(storageKey(boardId));
      else window.localStorage.setItem(storageKey(boardId), String(value));
    } catch {
      // 저장 실패는 이번 화면에만 적용한다.
    }
  }
  for (const listener of listeners) listener();
}

export function useBoardRowHeight(boardId: string): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read(boardId),
    () => ROW_HEIGHT_DEFAULT,
  );
}

/** 상담 화면 광고 정보 펼침 — 사람별 브라우저 설정(기본 접힘). */
const AD_KEY = "mw:consult-ad-open";
let adOpenMemory: boolean | null = null;
export function setConsultAdOpen(open: boolean): void {
  adOpenMemory = open;
  try { window.localStorage.setItem(AD_KEY, open ? "1" : "0"); } catch { /* 이번 화면만 */ }
  for (const listener of listeners) listener();
}
export function useConsultAdOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      if (adOpenMemory === null) {
        try { adOpenMemory = window.localStorage.getItem(AD_KEY) === "1"; } catch { adOpenMemory = false; }
      }
      return adOpenMemory;
    },
    () => false,
  );
}
