// T07 · 플랫폼 운영 콘솔(/platform) 타입.
//
// P0 원칙: 여기 어떤 타입도 **고객 업무 데이터의 내용**을 담지 않는다.
// 건수·시각·사용자 수·메타데이터만 존재한다(딜 제목·활동 내용·금액 없음).

/** 운영 등급. 조회는 전 등급 동일, 등급은 실행(쓰기)만 가른다. */
export const ADMIN_LEVELS = ["super", "operator", "viewer"] as const;
export type AdminLevel = (typeof ADMIN_LEVELS)[number];

/** 등급 서열 — 높을수록 강하다. platform_admin_at_least() 와 동일 규칙. */
export const ADMIN_LEVEL_RANK: Record<AdminLevel, number> = {
  super: 3,
  operator: 2,
  viewer: 1,
};

/** 조직 활동 상태. 위험순 정렬의 기준이 된다. */
export const ORG_HEALTH = ["dormant", "slowing", "active"] as const;
export type OrgHealth = (typeof ORG_HEALTH)[number];

/** 014 `platform_org_overview()` 행 — 메타데이터만. */
export interface OrgOverviewRow {
  orgId: string;
  name: string;
  planTier: string;
  isInternal: boolean;
  createdAt: string;
  memberCount: number;
  activeUsers7d: number;
  writes7d: number;
  errors7d: number;
  /** 마지막 활동 시각(ISO). 활동 이력이 없으면 null. */
  lastActivityAt: string | null;
}

/** 위험순 정렬을 마친 회사 목록 행. */
export interface OrgListEntry extends OrgOverviewRow {
  health: OrgHealth;
  /** 마지막 활동 이후 경과 일수. 활동이 없으면 null. */
  idleDays: number | null;
  /** 활성/전체 비율(0~1). 멤버가 0명이면 0. */
  activeRatio: number;
}

/** 014 `platform_metrics_range()` 행. */
export interface MetricsDailyRow {
  date: string;
  orgId: string;
  activeUsers: number;
  writes: number;
  errors: number;
  memberCount: number;
}

/** 활성 지표 — DAU/WAU/MAU + 스티키니스. */
export interface ActivityMetrics {
  /**
   * 기준일 — 롤업이 실제로 채운 **가장 최근 날짜**.
   * 야간 배치는 전일까지만 집계하므로 오늘이 아니다. 집계 이력이 없으면 null.
   */
  asOf: string | null;
  /** 기준일 하루의 활성 사용자. */
  dau: number;
  /** 기준일 포함 7일. */
  wau: number;
  /** 기준일 포함 30일. */
  mau: number;
  /** DAU ÷ MAU. MAU 가 0이면 0(0분모 방어). */
  stickiness: number;
}

/** 입력량 지표. */
export interface InputMetrics {
  /** 기간 내 쓰기 이벤트 총합. */
  writes: number;
  /** 조직별 일평균 쓰기수. 조직이 0이면 0. */
  writesPerOrgPerDay: number;
  /** 집계에 쓰인 일수. */
  days: number;
  /** 집계에 잡힌 조직 수. */
  orgCount: number;
}

/** TTFV 입력 1건 — 가입 시각과 첫 딜 생성 시각(내용 아님). */
export interface TtfvInput {
  orgId: string;
  name: string;
  signedUpAt: string;
  firstDealAt: string | null;
}

/** TTFV(가입→첫 딜) 요약. */
export interface TtfvMetrics {
  /** 첫 딜을 등록한 조직 수. */
  converted: number;
  /** 대상 조직 수(가입 전체). */
  total: number;
  /** 중앙값(시간). 전환 조직이 없으면 null. */
  medianHours: number | null;
  /** 평균(시간). 전환 조직이 없으면 null. */
  meanHours: number | null;
}

/** 건강도 지표. */
export interface HealthMetrics {
  /** 14일 무활동 조직 수. */
  dormantOrgs: number;
  /** 오류율 = 오류수 ÷ 쓰기수. 쓰기가 0이면 0. */
  errorRate: number;
  /** 미처리 가입요청 수. */
  pendingRequests: number;
  /** W1 리텐션(0~1). */
  retentionW1: number;
  /** W4 리텐션(0~1). */
  retentionW4: number;
}

/** 운영자 1명. */
export interface AdminEntry {
  email: string;
  level: AdminLevel;
  isPlatform: boolean;
  addedBy: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

/** 결제·매출 월별 집계 1행. */
export interface BillingMonthRow {
  month: string;
  invoiceCount: number;
  /** 공급가액(부가세 별도). */
  supplySum: number;
  vatSum: number;
  totalSum: number;
  paidSum: number;
}

/** 매출 지표 — MRR/ARR/NRR. */
export interface RevenueMetrics {
  /** 최근 월 공급가액 기준 MRR(부가세 제외). */
  mrr: number;
  /** ARR = MRR × 12. */
  arr: number;
  /**
   * NRR = 당월 ÷ 전월 (기존 고객 매출 유지율 근사).
   * 전월 매출이 0이면 null(정의 불가 — 0으로 표시하면 오해를 부른다).
   */
  nrr: number | null;
  /** 미수금 = 청구 합계 − 수납 합계. 음수는 0으로 절사. */
  outstanding: number;
}
