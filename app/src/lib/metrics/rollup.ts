/**
 * 야간 배치 롤업 — 하루치 조직 지표를 계산하는 **순수 함수**. (C4 인수 · T04)
 *
 * 설계 근거:
 *  - **실시간 전 조직 집계 금지.** 플랫폼 지표는 배치가 미리 계산해
 *    `platform_metrics_daily` 에 적재하고, 화면은 그 스냅샷만 읽는다.
 *    (P0 계약 O5 — 플랫폼 권한은 tenant RLS 를 우회하지 않는다.
 *     전 조직 실시간 조회는 그 경계를 넘게 되므로 구조적으로 배제한다.)
 *  - 이 파일에는 I/O 가 없다. 배치 러너가 데이터를 읽어 넣어 주고,
 *    여기서는 계산만 한다 → 더미 데이터로 수동 카운트 검증이 가능하다.
 *
 * 하루의 경계는 **KST**다. `day='2026-07-27'` 은
 * `2026-07-27T00:00+09:00` 이상 `2026-07-28T00:00+09:00` 미만을 뜻한다.
 */

import {
  MAU_WINDOW_DAYS,
  MS_PER_HOUR,
  DEFAULT_DORMANT_DAYS,
  dormancyBreakdown,
  parseAt,
  round,
  safeRatio,
  stickiness,
} from "./compute";
import type { ActivityEvent, DailyRollup } from "./types";

const KST_OFFSET_MS = 9 * MS_PER_HOUR;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * KST 날짜(YYYY-MM-DD)의 **시작** 시각을 UTC ISO 로.
 * 예) 2026-07-27 → 2026-07-26T15:00:00.000Z
 */
export function kstDayStartUtc(day: string): string | null {
  if (!DAY_RE.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - KST_OFFSET_MS).toISOString();
}

/**
 * KST 날짜의 **끝**(= 다음날 시작) 시각을 UTC ISO 로.
 * 하루치 집계의 `asOf` 로 쓴다 — 반열린 구간 [start, end) 의 end.
 */
export function kstDayEndUtc(day: string): string | null {
  const start = kstDayStartUtc(day);
  if (start === null) return null;
  return new Date(Date.parse(start) + 24 * MS_PER_HOUR).toISOString();
}

/** 롤업 입력 — 배치 러너가 저장소에서 읽어 채운다. */
export interface RollupInput {
  orgId: string;
  /** 집계 대상 KST 날짜(YYYY-MM-DD). */
  day: string;
  /**
   * 활동 이벤트. **MAU 창(30일)을 덮는 범위**를 넘겨야 한다 —
   * 하루치만 넘기면 MAU 가 DAU 와 같아져 스티키니스가 항상 1 이 된다.
   */
  events: readonly ActivityEvent[];
  /** 조직 전체 멤버 id — 휴면/미활성 분모. */
  memberIds: readonly string[];
  /** 딜 생성 시각(ISO) 목록. 그날 생성분을 센다. */
  dealCreatedAts: readonly string[];
  /** 휴면 임계 일수. 기본 30일. */
  dormantDays?: number;
}

/**
 * 하루치 롤업 1행 계산.
 *
 * 잘못된 `day` 는 던지지 않고 0 행을 돌려준다 — 배치가 한 조직 때문에 전체 중단되지 않도록.
 * (호출부는 `day` 를 스스로 생성하므로 정상 경로에서는 발생하지 않는다.)
 */
export function buildDailyRollup(input: RollupInput): DailyRollup {
  const { orgId, day } = input;
  const asOf = kstDayEndUtc(day);

  if (asOf === null) {
    return {
      day,
      orgId,
      dau: 0,
      mau: 0,
      stickiness: 0,
      activeUsers: 0,
      dormantUsers: 0,
      newDeals: 0,
    };
  }

  // 대상 조직 이벤트만 — 입력이 여러 조직을 섞어 와도 안전하게 좁힌다.
  const events = input.events.filter((e) => e.orgId === orgId);

  const s = stickiness(events, asOf, {
    dauWindowDays: 1,
    mauWindowDays: MAU_WINDOW_DAYS,
  });

  const dorm = dormancyBreakdown(
    input.memberIds,
    events,
    asOf,
    input.dormantDays ?? DEFAULT_DORMANT_DAYS,
  );

  return {
    day,
    orgId,
    dau: s.dau,
    mau: s.mau,
    stickiness: s.ratio,
    activeUsers: dorm.active,
    dormantUsers: dorm.dormant,
    newDeals: countCreatedOnDay(input.dealCreatedAts, day),
  };
}

/** 해당 KST 날짜(하루)에 생성된 건수. 반열린 구간 [dayStart, dayEnd). */
export function countCreatedOnDay(
  createdAts: readonly string[],
  day: string,
): number {
  const start = kstDayStartUtc(day);
  const end = kstDayEndUtc(day);
  if (start === null || end === null) return 0;

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  let n = 0;
  for (const at of createdAts) {
    const ms = parseAt(at);
    if (ms === null) continue;
    if (ms >= startMs && ms < endMs) n += 1;
  }
  return n;
}

/** 여러 조직을 한 번에 — 배치 러너가 조직 목록을 돌며 호출한다. */
export function buildDailyRollups(
  inputs: readonly RollupInput[],
): DailyRollup[] {
  return inputs.map(buildDailyRollup);
}

/**
 * 플랫폼 전체 합계 — 조직별 행을 하나로 접는다.
 *
 * ⚠ `dau`/`mau` 는 **조직별 고유 사용자의 단순 합**이다. 한 사람이 두 조직에
 * 속하면 중복 계상된다. 플랫폼 전역 고유 사용자를 원하면 조직 경계를 없앤
 * 별도 집계가 필요하다 — 여기서 그렇게 계산했다고 오해하지 않도록 명시한다.
 * `stickiness` 는 합계 비율을 **재계산**한다(비율의 평균이 아님).
 */
export function platformTotals(rows: readonly DailyRollup[]): {
  orgs: number;
  dauSum: number;
  mauSum: number;
  stickiness: number;
  activeUsers: number;
  dormantUsers: number;
  newDeals: number;
} {
  const sum = (pick: (r: DailyRollup) => number) =>
    rows.reduce((acc, r) => acc + pick(r), 0);

  const dauSum = sum((r) => r.dau);
  const mauSum = sum((r) => r.mau);

  return {
    orgs: rows.length,
    dauSum,
    mauSum,
    stickiness: round(safeRatio(dauSum, mauSum)),
    activeUsers: sum((r) => r.activeUsers),
    dormantUsers: sum((r) => r.dormantUsers),
    newDeals: sum((r) => r.newDeals),
  };
}
