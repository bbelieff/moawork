/**
 * 수식 컬럼 엔진 — 먼데이 formula 컬럼 재현 (T02).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ ⚠ 수식 정의는 가정(ASSUMPTION)이다. 원본 기획(001_schema)이 저장소에    │
 * │   없어 T02 가 저작했다. 실제 비즈니스 규칙 확정 시 **이 파일만** 고치면    │
 * │   된다. 각 수식은 아래 INPUT_KEYS 의 입력 컬럼 값으로부터 계산된다.       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * 도메인: 서울경영지원센터 — 정책자금 컨설팅/브로커리지.
 *
 * 입력 컬럼(계약 관련):
 *   - contract_amount (계약금액, number)  : 확보한 자금/계약 규모
 *   - commission_rate (수수료율, number %) : 센터가 청구하는 비율(%)
 *   - contract_date   (계약일, date)       : 계약 체결일 (D+N 기준일)
 *
 * 수식(가정):
 *   1. 수수료(commission)     = 계약금액 × 수수료율 / 100        (공급가액)
 *   2. 총매출(total_revenue)  = 수수료 × (1 + 부가세율)          (부가세 포함 총액)
 *                               부가세율 VAT_RATE = 0.1 (10%)
 *   3. D+180(d_plus_180)      = 계약일 + 180일                   (사후관리 시점)
 *   4. D+365(d_plus_365)      = 계약일 + 365일
 */

import type { CellValue, FormulaKey } from "./types";

/** 부가세율(가정: 10%). 확정 시 이 상수만 조정. */
export const VAT_RATE = 0.1;

/** 수식이 참조하는 입력 컬럼 key. */
export const INPUT_KEYS = {
  contractAmount: "contract_amount",
  commissionRate: "commission_rate",
  contractDate: "contract_date",
} as const;

/** 셀 값을 유한수로 강제. 파싱 불가면 null. */
export function toNumber(v: CellValue | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // 콤마/통화기호 제거 후 파싱
    const n = Number(v.replace(/[,\s₩]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 셀 값을 `YYYY-MM-DD` 날짜 문자열로 강제. 유효하지 않으면 null. */
export function toDateOnly(v: CellValue | undefined): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** 기준일에 days 를 더한 `YYYY-MM-DD`. base 가 유효하지 않으면 null. */
export function addDays(base: string | null, days: number): string | null {
  if (base === null) return null;
  const d = new Date(`${base}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 소수 2자리 반올림(통화). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 입력 컬럼값 맵(컬럼 key → 값)으로부터 단일 수식 값을 계산. */
export function evaluateFormula(
  key: FormulaKey,
  values: Record<string, CellValue>,
): CellValue {
  const amount = toNumber(values[INPUT_KEYS.contractAmount]);
  const rate = toNumber(values[INPUT_KEYS.commissionRate]);
  const date = toDateOnly(values[INPUT_KEYS.contractDate]);

  switch (key) {
    case "commission": {
      if (amount === null || rate === null) return null;
      return round2((amount * rate) / 100);
    }
    case "total_revenue": {
      if (amount === null || rate === null) return null;
      const commission = (amount * rate) / 100;
      return round2(commission * (1 + VAT_RATE));
    }
    case "d_plus_180":
      return addDays(date, 180);
    case "d_plus_365":
      return addDays(date, 365);
    default: {
      // 컴파일 타임 소진 체크
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

/**
 * 보드 컬럼 정의를 훑어 formula 컬럼들을 계산.
 * @returns 컬럼 key → 계산값
 */
export function evaluateFormulas(
  columns: { key: string; type: string; settings: { formulaKey?: FormulaKey } }[],
  values: Record<string, CellValue>,
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const col of columns) {
    if (col.type !== "formula") continue;
    const fk = col.settings.formulaKey;
    if (!fk) continue;
    out[col.key] = evaluateFormula(fk, values);
  }
  return out;
}
