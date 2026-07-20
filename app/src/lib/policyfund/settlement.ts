// T09 · 정산 수식(settlements) — 확정본.
//
// SSOT: supabase/migrations/002_seed_policyfund.sql 의 formulas 블록
//   fee_amount    = round(실행액 * 수수료% / 100)   ← 수수료%는 정수 퍼센트(3 = 3%)
//   total_revenue = 계약금 + 수수료(원)
//   d180          = 수수료입금일 + 180일
//   d365          = 수수료입금일 + 365일
// 또한 기획 v0.2 §3 ind.policyfund / §5(settlements generated column)과 일치.
//
// ⚠ T02 crm/formulas.ts 는 착수 시점 가정(총매출=수수료×1.1 부가세, D+n=계약일 기준,
//    base=계약금액)으로 저작되어 본 확정본과 불일치 — DQ 로 정합 요청(정산=T09 소유).

const MS_PER_DAY = 86_400_000;

/** 계약(집행) 1건의 정산 입력. 금액은 원 단위. */
export interface SettlementInput {
  /** 실행액(대출 실행액 = 수수료 산정 기준). */
  disbursedAmount: number;
  /** 수수료율(정수 퍼센트, 3 = 3%). */
  feePercent: number;
  /** 계약금. 총매출 산정에 가산. */
  downPayment: number;
  /** 수수료 입금일(D+n 기산일). 미입금이면 null → D+n 도 null. */
  feeDepositDate: Date | null;
}

/** 계약 1건의 정산 결과. */
export interface SettlementResult {
  /** 수수료(원) = round(실행액 × 수수료% / 100). */
  feeAmount: number;
  /** 총매출 = 계약금 + 수수료(원). */
  totalRevenue: number;
  /** D+180 (YYYY-MM-DD) 또는 null(수수료입금일 미정). */
  dPlus180: string | null;
  /** D+365 (YYYY-MM-DD) 또는 null. */
  dPlus365: string | null;
}

/**
 * 수수료(원) = round(실행액 × 수수료% / 100).
 * feePercent 는 정수 퍼센트(3 = 3%). 원 단위 반올림.
 */
export function feeAmount(disbursedAmount: number, feePercent: number): number {
  return Math.round((disbursedAmount * feePercent) / 100);
}

/** 총매출 = 계약금 + 수수료(원). */
export function totalRevenue(downPayment: number, fee: number): number {
  return downPayment + fee;
}

/**
 * 수수료입금일 기준 D+n (YYYY-MM-DD). base 가 null 이면 null.
 * UTC 기준 일수 가산(시간대 영향 배제).
 */
export function dPlus(feeDepositDate: Date | null, days: number): string | null {
  if (feeDepositDate === null) return null;
  const t = feeDepositDate.getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 계약 1건의 정산(수수료·총매출·D+180·D+365)을 산출한다. */
export function computeSettlement(input: SettlementInput): SettlementResult {
  const fee = feeAmount(input.disbursedAmount, input.feePercent);
  return {
    feeAmount: fee,
    totalRevenue: totalRevenue(input.downPayment, fee),
    dPlus180: dPlus(input.feeDepositDate, 180),
    dPlus365: dPlus(input.feeDepositDate, 365),
  };
}

/** 여러 건의 총매출 합계(대시보드 집계용). */
export function sumTotalRevenue(items: readonly SettlementInput[]): number {
  return items.reduce((sum, it) => {
    const fee = feeAmount(it.disbursedAmount, it.feePercent);
    return sum + totalRevenue(it.downPayment, fee);
  }, 0);
}
