import type { Job } from "pg-boss";
import type { OrgLister, RecomputeOutcome, RecomputeRunner } from "./recompute.js";

/** 월 마감 재계산 큐 이름 (설계 §2.4-b). */
export const PERF_MONTHLY_CLOSE_QUEUE = "perf.monthly-close";

/**
 * 잡 페이로드.
 *
 * `period` 는 **재실행(백필)용 선택 입력**이다. 스케줄러가 넣는 정기 실행은 비워 두고
 * 실행 시점의 KST 전월을 계산한다 — 페이로드에 날짜를 굳혀 두면 잡이 지연·재시도될 때
 * 옛 달을 다시 확정해 버린다.
 */
export interface PerfMonthlyCloseJobData {
  period?: string;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 페이로드 검증 — 외부 입력이므로 신뢰하지 않는다. */
export function isPerfMonthlyCloseJobData(
  value: unknown,
): value is PerfMonthlyCloseJobData {
  if (value === undefined || value === null) return true; // 빈 페이로드 = 정기 실행.
  if (typeof value !== "object") return false;
  const period = (value as { period?: unknown }).period;
  return period === undefined || (typeof period === "string" && PERIOD_RE.test(period));
}

/**
 * 확정할 달을 고른다 — 기준 시각의 **KST 전월**.
 *
 * UTC 로 계산하면 매월 1일 00:00~09:00 KST(= 전월 말일 15:00~24:00 UTC) 사이에 돌 때
 * 한 달이 더 밀린다. 배치는 바로 그 시간대(새벽)에 돌기 때문에 실제로 터지는 버그다.
 *
 * (앱 `@/lib/perf` 의 previousMonthKst 와 같은 규칙 — 워커는 앱 소스를 import 할 수
 * 없어 규칙만 복제하며, 양쪽 모두 테스트로 경계를 고정한다.)
 */
export function previousMonthKst(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface PerfMonthlyCloseDeps {
  orgs: OrgLister;
  runner: RecomputeRunner;
  /** 현재 시각 주입(테스트 결정성). */
  now?: () => Date;
  log?: (message: string) => void;
}

/** 잡 1건의 처리 결과 — 테스트/관측용. */
export type PerfMonthlyCloseOutcome =
  | { status: "done"; period: string; orgCount: number; failed: string[] }
  | { status: "invalid"; error: string };

/**
 * 월 마감 재계산 1회 처리.
 *
 * 조직 하나가 실패해도 **나머지는 계속 처리한다** — 한 조직의 깨진 인센티브 규칙 때문에
 * 다른 모든 조직의 월 마감이 통째로 밀리면 안 된다. 실패 목록은 결과에 담아 올리고,
 * 하나라도 실패하면 마지막에 throw 해 pg-boss 재시도에 맡긴다(재계산은 멱등이라
 * 성공한 조직을 다시 돌려도 안전하다).
 */
export async function processPerfMonthlyCloseJob(
  deps: PerfMonthlyCloseDeps,
  data: unknown,
): Promise<PerfMonthlyCloseOutcome> {
  const log = deps.log ?? ((m: string) => console.log(m));

  if (!isPerfMonthlyCloseJobData(data)) {
    const error = "잘못된 페이로드 — period 는 YYYY-MM 이어야 합니다";
    log(`[perf] ${error}`);
    return { status: "invalid", error };
  }

  const now = deps.now?.() ?? new Date();
  const period = data?.period ?? previousMonthKst(now);

  const orgIds = await deps.orgs.listOrgIds();
  if (orgIds.length === 0) {
    log(`[perf] 월 마감 대상 조직 0건 period=${period}`);
    return { status: "done", period, orgCount: 0, failed: [] };
  }

  const failed: string[] = [];
  const results: RecomputeOutcome[] = [];

  for (const orgId of orgIds) {
    try {
      results.push(await deps.runner.recompute({ orgId }, period));
    } catch (err) {
      // 조직 식별자만 남기고 오류 원문은 그대로 둔다 — 페이로드/PII 는 로그에 넣지 않는다.
      failed.push(orgId);
      log(
        `[perf] 조직 재계산 실패 orgId=${orgId} period=${period}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const rowTotal = results.reduce((sum, r) => sum + r.rowCount, 0);
  log(
    `[perf] 월 마감 완료 period=${period} 조직=${results.length}/${orgIds.length} 행=${rowTotal}`,
  );

  if (failed.length > 0) {
    throw new Error(
      `월 마감 재계산 일부 실패(재시도) period=${period} 실패=${failed.length}건`,
    );
  }

  return { status: "done", period, orgCount: results.length, failed };
}

/**
 * pg-boss v10 워크 핸들러.
 * v10 은 잡을 **배열(batch)** 로 전달하므로 순회 처리한다.
 */
export function createPerfMonthlyCloseHandler(deps: PerfMonthlyCloseDeps) {
  return async (jobs: Job<PerfMonthlyCloseJobData>[]): Promise<void> => {
    for (const job of jobs) {
      await processPerfMonthlyCloseJob(deps, job.data);
    }
  };
}
