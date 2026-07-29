// T07 · 플랫폼 콘솔 표시 포맷터(순수).
//
// 게이트 요건: 데이터 0건일 때 0 또는 '—' 로 표시하고 NaN·에러를 내지 않는다.

import { EMPTY } from "./access";
import type { OrgHealth } from "./types";

export { EMPTY };

/** 정수 건수 — 천단위 콤마. 유한수가 아니면 '—'. */
export function count(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  return new Intl.NumberFormat("ko-KR").format(value);
}

/** 원화 — 천단위 콤마 + '원'. */
export function krw(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

/** 비율(0~1) → 퍼센트. null 이면 '—'(0% 와 구분한다). */
export function percent(
  value: number | null | undefined,
  digits = 1,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  return `${(value * 100).toFixed(digits)}%`;
}

/** 시간(hours) → 사람이 읽는 길이. null 이면 '—'. */
export function duration(hours: number | null | undefined): string {
  if (typeof hours !== "number" || !Number.isFinite(hours)) return EMPTY;
  if (hours < 1) return `${Math.round(hours * 60)}분`;
  if (hours < 48) return `${hours.toFixed(1)}시간`;
  return `${(hours / 24).toFixed(1)}일`;
}

/** 경과 일수 → '오늘 / N일 전'. null 이면 '기록 없음'. */
export function idleLabel(days: number | null): string {
  if (days === null) return "기록 없음";
  if (days <= 0) return "오늘";
  return `${count(days)}일 전`;
}

/** ISO → 'YYYY-MM-DD'. 값이 없으면 '—'. */
export function day(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return EMPTY;
  return new Date(t).toISOString().slice(0, 10);
}

export const HEALTH_LABEL: Record<OrgHealth, string> = {
  dormant: "휴면",
  slowing: "둔화",
  active: "활발",
};
