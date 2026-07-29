/**
 * 야간 배치 러너 — 하루치 플랫폼 지표를 계산해 `platform_metrics_daily` 에 적재한다. (C4 · T04)
 *
 * 구조:
 *   MetricsSource(포트) → buildDailyRollup(순수 함수) → MetricsSink(포트)
 *
 * 이 파일은 I/O 를 **직접 하지 않는다**. Supabase 어댑터는 `batch-supabase.ts` 에 있고,
 * 테스트는 인메모리 포트를 끼워 같은 코드를 검증한다.
 *
 * 실시간 집계 금지: 이 배치만이 전 조직 데이터를 훑는다(service_role).
 * 콘솔은 결과 스냅샷만 읽는다 — P0 O5(플랫폼 권한은 tenant RLS 우회 금지) 준수.
 */

import { MAU_WINDOW_DAYS, MS_PER_DAY, dayKeyKst } from "./compute";
import { buildDailyRollup, kstDayEndUtc, kstDayStartUtc } from "./rollup";
import type { ActivityEvent, DailyRollup } from "./types";

/** 배치가 읽어야 하는 데이터 — 저장소 무관 포트. */
export interface MetricsSource {
  /** 집계 대상 조직 id 목록. */
  listOrgIds(): Promise<string[]>;
  /** 조직 멤버 id 목록(휴면 분모). */
  listMemberIds(orgId: string): Promise<string[]>;
  /**
   * `[fromIso, toIso)` 구간의 활동 이벤트.
   * MAU 창(30일)을 덮는 범위를 요청한다 — 하루치만 읽으면 스티키니스가 항상 1 이 된다.
   */
  listEvents(orgId: string, fromIso: string, toIso: string): Promise<ActivityEvent[]>;
  /** `[fromIso, toIso)` 구간에 생성된 딜의 생성시각 목록. */
  listDealCreatedAts(orgId: string, fromIso: string, toIso: string): Promise<string[]>;
}

/** 계산 결과 적재 포트. 멱등이어야 한다(같은 day+org 재실행 시 덮어쓰기). */
export interface MetricsSink {
  upsert(row: DailyRollup): Promise<void>;
}

export interface RunOptions {
  /** 집계할 KST 날짜(YYYY-MM-DD). 미지정이면 `asOf` 기준 **어제**. */
  day?: string;
  /** 기준 시각. 테스트에서 주입한다. 기본은 현재 시각. */
  asOf?: Date;
  /** 휴면 임계 일수. */
  dormantDays?: number;
}

export interface RunResult {
  day: string;
  /** 성공적으로 적재된 행. */
  rows: DailyRollup[];
  /**
   * 조직별 실패. 한 조직이 실패해도 배치 전체를 멈추지 않는다
   * (부분 성공을 정직하게 보고한다 — 조용히 0 으로 채우지 않는다).
   */
  failures: { orgId: string; error: string }[];
}

/** KST 기준 어제(YYYY-MM-DD). 야간 배치는 '완료된 하루'를 집계한다. */
export function previousDayKst(asOf: Date = new Date()): string {
  return dayKeyKst(new Date(asOf.getTime() - MS_PER_DAY));
}

/**
 * 하루치 배치 실행.
 *
 * 조직 단위로 격리해 처리하며, 한 조직에서 실패해도 나머지는 계속 진행한다.
 * 실패는 삼키지 않고 `failures` 로 돌려준다 — 호출부(cron route)가 상태코드에 반영한다.
 */
export async function runDailyRollup(
  source: MetricsSource,
  sink: MetricsSink,
  options: RunOptions = {},
): Promise<RunResult> {
  const day = options.day ?? previousDayKst(options.asOf ?? new Date());

  const dayStart = kstDayStartUtc(day);
  const dayEnd = kstDayEndUtc(day);
  if (dayStart === null || dayEnd === null) {
    throw new Error(`잘못된 집계 날짜입니다: ${day} (YYYY-MM-DD 필요)`);
  }

  // MAU 창을 덮도록 뒤로 30일 확장해서 읽는다.
  const windowStart = new Date(
    Date.parse(dayStart) - MAU_WINDOW_DAYS * MS_PER_DAY,
  ).toISOString();

  const rows: DailyRollup[] = [];
  const failures: RunResult["failures"] = [];

  const orgIds = await source.listOrgIds();

  for (const orgId of orgIds) {
    try {
      const [memberIds, events, dealCreatedAts] = await Promise.all([
        source.listMemberIds(orgId),
        source.listEvents(orgId, windowStart, dayEnd),
        source.listDealCreatedAts(orgId, dayStart, dayEnd),
      ]);

      const row = buildDailyRollup({
        orgId,
        day,
        events,
        memberIds,
        dealCreatedAts,
        dormantDays: options.dormantDays,
      });

      await sink.upsert(row);
      rows.push(row);
    } catch (err) {
      failures.push({
        orgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { day, rows, failures };
}
