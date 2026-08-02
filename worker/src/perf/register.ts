import type PgBoss from "pg-boss";
import {
  PERF_MONTHLY_CLOSE_QUEUE,
  createPerfMonthlyCloseHandler,
  type PerfMonthlyCloseDeps,
} from "./job.js";

/**
 * 월 마감 큐 정책.
 *
 * 재시도는 넉넉히 두되(재계산은 멱등이라 반복 실행이 안전하다) 백오프를 켠다 —
 * DB 가 잠깐 흔들렸을 때 즉시 3연타로 재시도하면 부하만 더한다.
 */
export const PERF_MONTHLY_CLOSE_QUEUE_OPTIONS = {
  name: PERF_MONTHLY_CLOSE_QUEUE,
  retryLimit: 3,
  retryBackoff: true,
} as const satisfies PgBoss.Queue;

/**
 * 실행 시각 — **매월 1일 04:00 (Asia/Seoul)**. 설계 §2.4-b "매월 1일 새벽 — 전월 확정".
 *
 * cron 은 타임존을 갖지 않으므로 `tz` 를 반드시 함께 준다. UTC 로 두면 KST 로는
 * 1일 09:00 에 돌아 업무 시간과 겹친다.
 */
export const PERF_MONTHLY_CLOSE_CRON = "0 4 1 * *";
export const PERF_MONTHLY_CLOSE_TZ = "Asia/Seoul";

/**
 * 월 마감 재계산 워커 등록.
 *
 * pg-boss v10 은 send/work/schedule 전에 큐가 존재해야 하므로 createQueue 를 먼저 부른다.
 * 스케줄은 큐 이름 기준 upsert 라 재기동해도 중복 등록되지 않는다.
 */
export async function registerPerfMonthlyClose(
  boss: PgBoss,
  deps: PerfMonthlyCloseDeps,
): Promise<void> {
  await boss.createQueue(PERF_MONTHLY_CLOSE_QUEUE, PERF_MONTHLY_CLOSE_QUEUE_OPTIONS);
  await boss.work(PERF_MONTHLY_CLOSE_QUEUE, createPerfMonthlyCloseHandler(deps));
  // 페이로드를 비워 둔다 — 실행 시점에 KST 전월을 계산한다(job.ts 주석 참고).
  await boss.schedule(PERF_MONTHLY_CLOSE_QUEUE, PERF_MONTHLY_CLOSE_CRON, undefined, {
    tz: PERF_MONTHLY_CLOSE_TZ,
  });
}
