/**
 * 제품 사용 지표(product analytics) 타입 — C4 인수.
 *
 * 경계: `@/lib/perf`(T07)는 **매출 성과**(정산·리더보드) 지표다. 여기는 **제품 사용** 지표
 * (스티키니스·휴면·TTFV)로 성격이 다르다. 두 모듈을 섞지 않는다.
 *
 * 원칙:
 *  - 이 파일의 함수는 전부 **순수 함수**다. 저장소·시간·환경에 의존하지 않는다
 *    (`asOf` 를 항상 인자로 받는다 — `new Date()` 를 내부에서 부르지 않는다).
 *  - 입력은 최소 형태(`ActivityEvent`)라 activities / audit_logs / 임의 이벤트 소스에
 *    모두 적용된다.
 */

/** 집계 입력 이벤트 — 누가(actor) 언제(at) 활동했는가. 그 외 필드는 지표에 쓰지 않는다. */
export interface ActivityEvent {
  /** 조직 id. 조직별 집계 시 사용. */
  orgId: string;
  /** 행위자. null 이면 시스템 발생 이벤트로 보고 **활성 사용자 집계에서 제외**한다. */
  actorId: string | null;
  /** 발생 시각(ISO 8601). */
  at: string;
}

/**
 * 스티키니스 = DAU / MAU.
 *
 * 업계 관행대로 **고유 사용자 수** 기준이며, 창(window)은 반열린 구간이다.
 *  - DAU 창: [asOf - 1일, asOf)
 *  - MAU 창: [asOf - 30일, asOf)
 * DAU 창은 MAU 창의 부분집합이므로 ratio 는 항상 0..1 이다.
 */
export interface Stickiness {
  /** 일간 고유 활성 사용자. */
  dau: number;
  /** 월간(30일) 고유 활성 사용자. */
  mau: number;
  /** DAU/MAU. mau=0 이면 0 (0분모 방어). */
  ratio: number;
  /** 집계 기준 시각(ISO) — 재현성을 위해 결과에 박아 둔다. */
  asOf: string;
}

/** 휴면 판정 결과. */
export interface DormancyVerdict {
  /** 마지막 활동 이후 경과 일수. 활동 이력이 없으면 null. */
  daysSinceLastActive: number | null;
  /** 휴면 여부. 활동 이력이 아예 없으면 **휴면이 아니라 '미활성(never active)'** 로 구분한다. */
  dormant: boolean;
  /** 활동 이력이 한 번도 없는가. */
  neverActive: boolean;
  /** 판정에 쓴 임계 일수. */
  thresholdDays: number;
}

/** 조직 단위 휴면 집계. */
export interface DormancyBreakdown {
  total: number;
  active: number;
  dormant: number;
  neverActive: number;
  /** 휴면 비율 = dormant / total. total=0 이면 0. */
  dormantRatio: number;
}

/**
 * TTFV(Time-to-First-Value) — 가입(조직 생성)부터 첫 가치 실현까지 걸린 시간.
 *
 * "가치(value)"의 정의는 호출부가 정한다(첫 딜 생성 / 첫 수납 등).
 * 이 모듈은 두 시각의 차이만 계산한다 — 정의를 코드에 못박지 않는다.
 */
export interface TtfvEntry {
  orgId: string;
  /** 기산점(조직 생성 시각, ISO). */
  startedAt: string;
  /** 첫 가치 실현 시각(ISO). 아직 미도달이면 null. */
  reachedAt: string | null;
  /** 도달까지 걸린 시간(시간 단위, 소수점 2자리). 미도달이면 null. */
  hours: number | null;
  /** 미도달 여부. */
  pending: boolean;
}

/** TTFV 코호트 요약 — 미도달 건은 중앙값/평균에서 제외한다(생존 편향 방지 표기). */
export interface TtfvSummary {
  /** 코호트 전체 조직 수. */
  total: number;
  /** 가치 도달 조직 수. */
  reached: number;
  /** 미도달 조직 수. */
  pending: number;
  /** 도달 비율 = reached / total. total=0 이면 0. */
  reachRate: number;
  /** 도달 건의 중앙값(시간). 도달 0건이면 null. */
  medianHours: number | null;
  /** 도달 건의 평균(시간). 도달 0건이면 null. */
  meanHours: number | null;
}

/** 하루치 롤업 1행 — 009_metric_rollups.metric_daily_rollups 와 1:1. */
export interface DailyRollup {
  /** 집계 대상 날짜(YYYY-MM-DD, KST 기준 하루). */
  day: string;
  orgId: string;
  dau: number;
  mau: number;
  stickiness: number;
  activeUsers: number;
  dormantUsers: number;
  newDeals: number;
}
