// T09 · 정산 수식(settlements).
//
// 사용자 명세 4종: 수수료 · 총매출 · D+180 · D+365.
//
// [정의 · 가정]
// - 수수료(commission) = 집행금액 × 수수료율. (수수료의 보편적 정의: 순수 산술)
// - 총매출(totalRevenue) = 인식된 수수료(매출)의 합. 회사 관점 매출은 컨설팅 수수료.
//   ※ "집행금액=총매출" 로 보는 정의(대출 실행액 기준)를 쓰는 경우가 있어,
//      집행금액 기준 총매출도 grossFromDisbursement() 로 별도 제공한다.
// - D+180 / D+365 = 계약일 기준 +180일 / +365일 정산 시점(1차/2차 정산일).
//
// 실제 수수료율·정산 규칙(반올림 단위, 부가세 등)의 SSOT 는
// 기획 v0.2 / 002_seed_policyfund.sql 다. 확정 시 이 모듈의 가정을 대조·조정한다.

import { toDateString } from "../format";

const MS_PER_DAY = 86_400_000;

/** 계약(집행) 1건의 정산 입력. */
export interface SettlementInput {
  /** 집행금액(대출 실행액 등 수수료 산정 기준액). 원 단위. */
  disbursedAmount: number;
  /** 수수료율. 비율(예: 0.03 = 3%). */
  feeRate: number;
  /** 계약일(정산 기산일). */
  contractDate: Date;
}

/** 계약 1건의 정산 결과. */
export interface SettlementResult {
  /** 수수료 = 집행금액 × 수수료율(원 단위 반올림). */
  commission: number;
  /** 1차 정산일 D+180 (YYYY-MM-DD). */
  settlementDate180: string;
  /** 2차 정산일 D+365 (YYYY-MM-DD). */
  settlementDate365: string;
}

/**
 * 수수료 = 집행금액 × 수수료율. 원 단위 반올림.
 * feeRate 는 비율(0.03 = 3%). 음수 입력은 그대로 계산(호출부 검증 책임).
 */
export function commission(disbursedAmount: number, feeRate: number): number {
  return Math.round(disbursedAmount * feeRate);
}

/**
 * 계약일 기준 D+n 정산일.
 * UTC 기준 일수 가산 후 YYYY-MM-DD 문자열로 반환(시간대 영향 배제).
 */
export function settlementDate(contractDate: Date, days: number): string {
  return toDateString(new Date(contractDate.getTime() + days * MS_PER_DAY));
}

/** 계약 1건의 정산(수수료 + D+180 + D+365)을 산출한다. */
export function computeSettlement(input: SettlementInput): SettlementResult {
  return {
    commission: commission(input.disbursedAmount, input.feeRate),
    settlementDate180: settlementDate(input.contractDate, 180),
    settlementDate365: settlementDate(input.contractDate, 365),
  };
}

/**
 * 총매출 = 여러 계약 건의 수수료(매출) 합.
 * 회사 관점 매출(컨설팅 수수료 합계) 정의.
 */
export function totalRevenue(items: readonly SettlementInput[]): number {
  return items.reduce(
    (sum, it) => sum + commission(it.disbursedAmount, it.feeRate),
    0,
  );
}

/**
 * 총매출(집행금액 기준) = 집행금액의 합.
 * "총매출 = 대출 실행액" 정의를 쓰는 경우를 위한 대안 산출.
 */
export function grossFromDisbursement(
  items: readonly SettlementInput[],
): number {
  return items.reduce((sum, it) => sum + it.disbursedAmount, 0);
}
