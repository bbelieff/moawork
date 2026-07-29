/**
 * 제품 사용 지표(product metrics) 배럴 — C4 인수(T04).
 *
 * 이름이 비슷한 이웃 모듈과 혼동하지 말 것:
 *  - `@/lib/analytics` (C5) = **이벤트 수집**(PostHog SDK·스크러빙·리플레이). 수집 쪽.
 *  - `@/lib/perf` (T07)     = **매출 성과**(정산·리더보드).
 *  - 여기 `@/lib/metrics`   = **사용 지표 집계**(스티키니스·휴면·TTFV). 계산 쪽.
 *
 * 집계는 야간 배치가 `platform_metrics_daily` 에 적재하고, 화면은 그 스냅샷만 읽는다
 * (실시간 전 조직 집계 금지 — P0 O5: 플랫폼 권한은 tenant RLS 를 우회하지 않는다).
 */

export * from "./types";
export * from "./compute";
export * from "./rollup";
export {
  runDailyRollup,
  previousDayKst,
  type MetricsSource,
  type MetricsSink,
  type RunOptions,
  type RunResult,
} from "./batch";
