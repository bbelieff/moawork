// T04 · core.dash 표시 포맷터(순수).
//
// 게이트 요건: 데이터 0건일 때 0 또는 '—' 로 표시하고 NaN·에러를 내지 않는다.

import {
  formatKrw as formatTypedKrw,
  formatQuantity,
  formatRatio,
} from "@/lib/format/number";

/** 값 없음 표시. */
export const EMPTY = "—";

/** 원화 금액 — 천단위 콤마 + '원'. 유한수가 아니면 '—'. */
export function formatKrw(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  return formatTypedKrw(value, { rounding: "round" });
}

/** 정수 건수 — 천단위 콤마. 유한수가 아니면 '—'. */
export function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  try {
    return formatQuantity(value);
  } catch {
    return EMPTY;
  }
}

/**
 * 비율(0~1) → 퍼센트 문자열. 소수 1자리.
 * 유한수가 아니면 '—'. 0 은 '0.0%'(NaN 금지).
 */
export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return EMPTY;
  try {
    return formatRatio(ratio, { fractionDigits: digits });
  } catch {
    return EMPTY;
  }
}

/** available=false 면 '—', 아니면 포맷 결과. */
export function orEmpty<T>(
  available: boolean,
  value: T,
  fmt: (v: T) => string,
): string {
  return available ? fmt(value) : EMPTY;
}

/** `YYYY-MM` → '2026년 7월'. 형식이 아니면 원문 그대로. */
export function formatMonth(yyyyMm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm);
  if (!m) return yyyyMm;
  return `${m[1]}년 ${Number(m[2])}월`;
}
