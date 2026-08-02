import type PgBoss from "pg-boss";
import {
  PLATFORM_ROLLUP_CRON,
  PLATFORM_ROLLUP_QUEUE,
  createPlatformRollupHandler,
  type PlatformRollupDeps,
} from "./rollup.js";

/** 롤업 큐 정책. 야간 1회라 실패 시 재시도를 넉넉히 둔다. */
export const PLATFORM_ROLLUP_OPTIONS = {
  name: PLATFORM_ROLLUP_QUEUE,
  retryLimit: 3,
  retryBackoff: true,
} as const satisfies PgBoss.Queue;

/**
 * 플랫폼 지표 야간 롤업 등록.
 *
 * pg-boss v10 은 send/work/schedule 전에 큐가 존재해야 하므로 createQueue 를 먼저
 * 호출한다(T06 notify 등록과 같은 패턴 — 부트스트랩을 중복하지 않는다).
 */
export async function registerPlatformMetricsRollup(
  boss: PgBoss,
  deps: PlatformRollupDeps,
): Promise<void> {
  await boss.createQueue(PLATFORM_ROLLUP_QUEUE, PLATFORM_ROLLUP_OPTIONS);
  await boss.work(PLATFORM_ROLLUP_QUEUE, createPlatformRollupHandler(deps));
  // 매일 03:10 KST. schedule 은 멱등이라 재기동해도 중복 등록되지 않는다.
  await boss.schedule(PLATFORM_ROLLUP_QUEUE, PLATFORM_ROLLUP_CRON);
}
