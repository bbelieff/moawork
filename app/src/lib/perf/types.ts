// T07 · mod.perf — KPI 리더보드 / 이달의 계약회사 타입.
//
// 원칙(T07 설계 §2.1 기간 귀속): 성과의 귀속 월은 **settlements.fee_paid_at(수납일)** 이다.
// 인센티브는 실현(수납) 기준으로 지급하므로 fee_paid_at 이 null 인 정산은 **미실현 → 집계 제외**.
// 대시보드의 "계약단계 도달"(파이프라인 KPI, T04 conversionRate)과는 **다른 지표**다 —
// 화면에서 라벨을 섞지 않는다("수납 N건" vs "계약단계 N건").
//
// 이중저장 금지: 여기 타입들은 전부 원본(settlements/deals)에서 매 요청 파생한다.
// performance_snapshots 영속화는 Phase 2(설계 §2.4) — B5 범위 밖.

import type { DateRange } from "@/lib/dash/types";

export type { DateRange };

/** 리더보드 정렬 기준. B5 범위(인센티브는 Phase 2). */
export type LeaderboardSort = "fee" | "exec" | "deals";

/** 담당자 1인의 기간 실적. 금액은 전부 원(₩) 정수. */
export interface LeaderboardRow {
  /** 미배정(assigned_to=null) 버킷이면 null. */
  userId: string | null;
  /** 사용자 이름. 미상이면 이메일, 그것도 없으면 '(이름없음)'. 미배정 버킷은 '조직 공통'. */
  name: string;
  /** 수납 발생 건수(= 귀속월 정산 행 수). */
  dealCount: number;
  /** 실행액 합계 — settlements.exec_amount. */
  execSum: number;
  /**
   * 수수료 합계 — settlements.fee_amount.
   * 001 의 generated column(이미 round 완료)이므로 **앱에서 재반올림하지 않는다**
   * (중복 반올림 오차 방지, 설계 §2.2).
   */
  feeSum: number;
  /**
   * 순위(1부터). 동점은 같은 순위를 공유하고 다음 순위를 건너뛴다(1,2,2,4).
   * 미배정 버킷은 순위 밖 → null (설계 §2.1).
   */
  rank: number | null;
}

/** 리더보드 — 기간 + 순위 행 + 조직 합계. */
export interface Leaderboard {
  /** 기준 월 (YYYY-MM, KST). */
  period: string;
  range: DateRange;
  sort: LeaderboardSort;
  /** 순위 대상 행(정렬 완료). 미배정 버킷은 제외. */
  rows: LeaderboardRow[];
  /**
   * 미배정(딜에 담당자가 없거나 정산에 딜이 연결되지 않은) 버킷.
   * 해당 정산이 하나도 없으면 null — 화면에서 행 자체를 숨긴다.
   */
  unassigned: LeaderboardRow | null;
  /** 조직 합계(미배정 포함) — 테이블 푸터용. */
  totals: { dealCount: number; execSum: number; feeSum: number };
}

/** 이달 수납이 발생한 고객사 1곳. */
export interface ContractCompanyEntry {
  /** 정산의 딜에 고객사가 연결되지 않았으면 null. */
  companyId: string | null;
  /** 고객사명. 미연결이면 '(고객사 미지정)'. */
  name: string;
  /** 해당 고객사의 이달 수납 건수. */
  dealCount: number;
  execSum: number;
  feeSum: number;
  /** 이달 수납 중 가장 늦은 fee_paid_at (ISO). */
  latestPaidAt: string;
}

/**
 * 이달의 계약회사 — fee_paid_at 이 기준월인 정산을 고객사별로 묶은 것.
 * 수수료 합계 내림차순 정렬이며 `top` 이 '이달의 계약회사'.
 */
export interface MonthlyContractCompanies {
  period: string;
  range: DateRange;
  /** 이달 수납이 1건도 없으면 false — 화면은 '—'/빈 상태를 표시한다. */
  available: boolean;
  /** 1위 고객사. available=false 면 null. */
  top: ContractCompanyEntry | null;
  /** 전체 목록(수수료 내림차순). */
  entries: ContractCompanyEntry[];
}
