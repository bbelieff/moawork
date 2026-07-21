// T04 · core.dash 대시보드 집계 타입.
//
// 원칙(PLAN-v0.2 §3 core.dash): 대시보드 수치는 **원본에서 파생(뷰)** 한다.
// 별도 집계 테이블에 이중저장하지 않는다 → drift 없음.
// 원천: deals / stages / field_defs (@/lib/repo, 담당범위 적용) + 정산 수식(T09).

import type { StageKind } from "@/lib/types";

/** 단계 1개의 집계 — 건수 + 전체 대비 비율. */
export interface StageCount {
  stageId: string;
  name: string;
  kind: StageKind;
  sortOrder: number;
  count: number;
  /** 전체 딜 대비 비율(0~1). 전체 0건이면 0. */
  ratio: number;
}

/** 파이프라인 단계별 현황. 빈 단계도 포함한다(먼데이 그룹 재현). */
export interface PipelineBreakdown {
  /** 집계 대상 전체 딜 수(단계 미지정 포함). */
  total: number;
  /** 단계가 지정되지 않은 딜 수. */
  unassigned: number;
  stages: StageCount[];
}

/**
 * 전환율 — 분모/분자 정의를 명시한다(게이트 요건).
 *   분모 = 집계 대상 전체 딜 수
 *   분자 = 해당 종류(kind)의 **첫 단계 이상**에 도달한 딜 수
 * 전체 0건이면 rate = 0 (0분모 방어).
 */
export interface ConversionRate {
  kind: StageKind;
  reached: number;
  total: number;
  rate: number;
}

/** 계약상황(field_defs select 프리셋) 분포 1개. */
export interface ContractStatusCount {
  optionId: string;
  label: string;
  count: number;
  ratio: number;
}

/** 계약상황 분포 — 미입력(unset) 을 분리한다. */
export interface ContractStatusBreakdown {
  /** field_defs 에 '계약상황' 필드가 없으면 false — 화면은 '—' 로 표시. */
  available: boolean;
  fieldKey: string | null;
  total: number;
  unset: number;
  options: ContractStatusCount[];
}

/** 정산 요약(T09 확정 수식 기반). 원천 데이터가 없으면 available=false. */
export interface SettlementSummary {
  available: boolean;
  /**
   * 임시 추정치 여부.
   * true = settlements 원천(실행액·수수료율)이 없어 `deal.amount` 로 대체 계산한 값.
   * 화면은 반드시 "임시" 표기를 함께 노출한다.
   */
  provisional: boolean;
  /** 정산 입력이 완전한 딜 건수(임시 계산 시에는 amount 가 있는 딜 수). */
  count: number;
  /** 계약금 합계. 임시 계산 시 0. */
  downPaymentSum: number;
  /** 수수료(원) 합계. 임시 계산 시 0(수수료율 미상). */
  feeSum: number;
  /** 총매출 합계 = 계약금 + 수수료. 임시 계산 시 deal.amount 합계. */
  totalRevenueSum: number;
}

/** 재접촉 대상 1건 (D+180 / D+365). */
export interface ReContactEntry {
  dealId: string;
  title: string;
  /** 수수료입금일 미정이면 null. */
  dPlus180: string | null;
  dPlus365: string | null;
}

/** 기간(반열린 구간 [start, end)) — UTC ISO 문자열. */
export interface DateRange {
  start: string;
  end: string;
}
