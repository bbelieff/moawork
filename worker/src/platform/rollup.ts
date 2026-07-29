// T07 · 플랫폼 지표 야간 롤업 잡.
//
// 화면은 `platform_metrics_daily` 만 읽는다(실시간 집계 금지) — 그 테이블을 채우는 것이
// 이 잡의 유일한 책임이다. 실제 집계는 014 의 `rollup_platform_metrics_daily(date)` 가
// DB 안에서 수행한다(집계 함수만 사용, 고객 업무 데이터의 내용 미조회).
//
// 재계산 창(RECOMPUTE_DAYS): 전일만 돌리면 자정 부근에 지각 도착한 이벤트가 영영
// 반영되지 않는다. 최근 며칠을 다시 upsert 해 보정한다 — 함수가 멱등이라 안전하다.

/** 잡 큐 이름. */
export const PLATFORM_ROLLUP_QUEUE = "platform.metrics.rollup";

/** 매일 03:10 KST = 18:10 UTC(전날). 고객 트래픽이 가장 적은 시간대. */
export const PLATFORM_ROLLUP_CRON = "10 18 * * *";

/** 전일 포함 최근 N일을 재계산한다(지각 데이터 보정). */
export const RECOMPUTE_DAYS = 3;

/** 하루치 롤업을 실행하는 어댑터. 반환값은 upsert 된 행 수. */
export type RollupRunner = (date: string) => Promise<number>;

export interface PlatformRollupDeps {
  runner: RollupRunner;
  /** 기준 시각 주입(테스트 결정성). */
  now?: () => Date;
}

/** UTC 기준 n일 전 날짜(YYYY-MM-DD). */
export function dateNDaysAgo(n: number, now: Date): string {
  return new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 재계산 대상 날짜 목록 — 어제부터 과거로 RECOMPUTE_DAYS 일.
 * 오늘은 넣지 않는다(아직 끝나지 않은 날이라 값이 계속 변한다).
 */
export function rollupTargets(now: Date, days = RECOMPUTE_DAYS): string[] {
  return Array.from({ length: days }, (_, i) => dateNDaysAgo(i + 1, now));
}

export interface RollupResult {
  dates: string[];
  rows: number;
  failed: string[];
}

/**
 * 롤업 핸들러 본체.
 *
 * 하루가 실패해도 나머지 날짜는 계속 진행한다 — 하루치 실패로 전체 배치를 죽이면
 * 지표가 통째로 비게 된다. 실패한 날짜는 결과에 담아 다음 실행이 재시도하게 둔다
 * (함수가 멱등이라 중복 실행이 안전하다).
 */
export function createPlatformRollupHandler(deps: PlatformRollupDeps) {
  return async function handle(): Promise<RollupResult> {
    const now = deps.now?.() ?? new Date();
    const dates = rollupTargets(now);
    let rows = 0;
    const failed: string[] = [];

    for (const date of dates) {
      try {
        rows += await deps.runner(date);
      } catch (err) {
        failed.push(date);
        console.error(`[worker] ${PLATFORM_ROLLUP_QUEUE} 실패 ${date}`, err);
      }
    }

    console.log(
      `[worker] ${PLATFORM_ROLLUP_QUEUE} 완료 — ${dates.length}일 / ${rows}행` +
        (failed.length ? ` / 실패 ${failed.join(",")}` : ""),
    );
    return { dates, rows, failed };
  };
}

/**
 * 미구현 러너(스텁).
 *
 * 실제 실행에는 service_role 연결이 필요하다 — `rollup_platform_metrics_daily` 는
 * authenticated 에게 execute 를 주지 않았기 때문이다(운영자 화면이 집계를 못 돌리게 막음).
 * 활성화 조건: worker 에 service_role 키를 env 로 주입하고 아래를 실제 호출로 교체.
 *   → `select public.rollup_platform_metrics_daily($1)`
 * 그 전까지는 0행을 반환해 배치가 조용히 통과한다(가짜 데이터를 만들지 않는다).
 */
export const pendingRollupRunner: RollupRunner = async (date: string) => {
  console.log(`[worker] ${PLATFORM_ROLLUP_QUEUE} 스텁 — ${date} 집계 생략(service_role 미주입)`);
  return 0;
};
