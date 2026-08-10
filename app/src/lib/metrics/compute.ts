/**
 * 제품 사용 지표 순수 함수 — C4 인수.
 *
 * 전부 순수 함수다. `new Date()` 를 부르지 않고 `asOf` 를 인자로 받으므로
 * 야간 배치(과거 날짜 재집계)와 화면(현재 시각)이 **같은 코드**를 쓴다.
 */

import type {
  ActivityEvent,
  DormancyBreakdown,
  DormancyVerdict,
  Stickiness,
  TtfvEntry,
  TtfvSummary,
} from "./types";

export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 기본 창 크기 — DAU 1일, MAU 30일. */
export const DAU_WINDOW_DAYS = 1;
export const MAU_WINDOW_DAYS = 30;

/** 휴면 기본 임계 — 마지막 활동 후 30일. */
export const DEFAULT_DORMANT_DAYS = 30;

/**
 * ISO 문자열 → epoch ms. 파싱 불가면 null.
 * 지표 입력은 DB/외부에서 오므로 형식을 신뢰하지 않는다(조용히 NaN 전파 금지).
 */
export function parseAt(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** 0분모 방어 비율. total<=0 이면 0. */
export function safeRatio(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

/** 소수점 자리 반올림(부동소수 오차 억제). */
export function round(value: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * 반열린 창 [asOf - windowDays, asOf) 안의 고유 actor 수.
 * `actorId=null`(시스템 이벤트)은 사용자로 세지 않는다.
 */
export function uniqueActorsInWindow(
  events: readonly ActivityEvent[],
  asOfMs: number,
  windowDays: number,
): Set<string> {
  const start = asOfMs - windowDays * MS_PER_DAY;
  const actors = new Set<string>();
  for (const e of events) {
    if (e.actorId === null) continue;
    const ms = parseAt(e.at);
    if (ms === null) continue;
    if (ms >= start && ms < asOfMs) actors.add(e.actorId);
  }
  return actors;
}

/**
 * 스티키니스 = DAU/MAU (고유 사용자 기준).
 *
 * DAU 창이 MAU 창의 부분집합이라 ratio 는 0..1 로 수렴한다.
 * 잘못된 `asOf` 는 던지지 않고 빈 지표를 돌려준다(배치가 한 행 때문에 죽지 않도록).
 */
export function stickiness(
  events: readonly ActivityEvent[],
  asOf: string,
  opts: { dauWindowDays?: number; mauWindowDays?: number } = {},
): Stickiness {
  const asOfMs = parseAt(asOf);
  if (asOfMs === null) return { dau: 0, mau: 0, ratio: 0, asOf };

  const dauDays = opts.dauWindowDays ?? DAU_WINDOW_DAYS;
  const mauDays = opts.mauWindowDays ?? MAU_WINDOW_DAYS;

  const dau = uniqueActorsInWindow(events, asOfMs, dauDays).size;
  const mau = uniqueActorsInWindow(events, asOfMs, mauDays).size;

  return { dau, mau, ratio: round(safeRatio(dau, mau)), asOf };
}

/**
 * 사용자별 마지막 활동 시각(epoch ms) 맵.
 * 휴면 판정의 공통 입력 — 이벤트를 한 번만 순회한다.
 */
export function lastActiveByActor(
  events: readonly ActivityEvent[],
): Map<string, number> {
  const last = new Map<string, number>();
  for (const e of events) {
    if (e.actorId === null) continue;
    const ms = parseAt(e.at);
    if (ms === null) continue;
    const prev = last.get(e.actorId);
    if (prev === undefined || ms > prev) last.set(e.actorId, ms);
  }
  return last;
}

/**
 * 휴면 판정.
 *
 * 활동 이력이 **한 번도 없는** 경우를 휴면과 구분한다(`neverActive`).
 * 온보딩 실패(never)와 이탈(dormant)은 대응이 다르므로 같은 수치로 뭉개지 않는다.
 */
export function dormancy(
  lastActiveAt: string | null,
  asOf: string,
  thresholdDays: number = DEFAULT_DORMANT_DAYS,
): DormancyVerdict {
  const asOfMs = parseAt(asOf);
  const lastMs = parseAt(lastActiveAt);

  if (lastMs === null || asOfMs === null) {
    return {
      daysSinceLastActive: null,
      dormant: false,
      neverActive: true,
      thresholdDays,
    };
  }

  // 미래 시각은 0일로 클램프(시계 오차가 음수 일수를 만들지 않도록).
  const days = Math.max(0, (asOfMs - lastMs) / MS_PER_DAY);
  return {
    daysSinceLastActive: round(days, 2),
    dormant: days >= thresholdDays,
    neverActive: false,
    thresholdDays,
  };
}

/**
 * 조직 구성원 전체의 휴면 분포.
 * `memberIds` 는 조직의 전체 멤버 — 이벤트에 없는 멤버가 `neverActive` 로 잡힌다.
 */
export function dormancyBreakdown(
  memberIds: readonly string[],
  events: readonly ActivityEvent[],
  asOf: string,
  thresholdDays: number = DEFAULT_DORMANT_DAYS,
): DormancyBreakdown {
  const last = lastActiveByActor(events);
  let active = 0;
  let dormant = 0;
  let neverActive = 0;

  for (const id of memberIds) {
    const lastMs = last.get(id);
    const verdict = dormancy(
      lastMs === undefined ? null : new Date(lastMs).toISOString(),
      asOf,
      thresholdDays,
    );
    if (verdict.neverActive) neverActive += 1;
    else if (verdict.dormant) dormant += 1;
    else active += 1;
  }

  const total = memberIds.length;
  return {
    total,
    active,
    dormant,
    neverActive,
    dormantRatio: round(safeRatio(dormant, total)),
  };
}

/**
 * TTFV 1건 — 기산점부터 첫 가치 실현까지.
 *
 * `reachedAt` 이 `startedAt` 보다 이르면(데이터 이상) 0시간으로 클램프하지 않고
 * **pending 으로 처리**한다 — 음수 소요시간을 지표에 넣지 않기 위함이다.
 */
export function ttfv(
  orgId: string,
  startedAt: string,
  reachedAt: string | null,
): TtfvEntry {
  const startMs = parseAt(startedAt);
  const reachMs = parseAt(reachedAt);

  if (startMs === null || reachMs === null || reachMs < startMs) {
    return { orgId, startedAt, reachedAt, hours: null, pending: true };
  }

  return {
    orgId,
    startedAt,
    reachedAt,
    hours: round((reachMs - startMs) / MS_PER_HOUR, 2),
    pending: false,
  };
}

/** 정렬된 수열의 중앙값. 빈 배열이면 null. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : round((sorted[mid - 1] + sorted[mid]) / 2, 2);
}

/**
 * TTFV 코호트 요약.
 * 미도달(pending) 건은 중앙값·평균에서 **제외**한다 — 도달한 것만 평균내면
 * 낙관 편향이 생기므로 화면은 `reachRate` 를 반드시 함께 표시한다.
 */
export function ttfvSummary(entries: readonly TtfvEntry[]): TtfvSummary {
  const hours = entries
    .filter((e) => !e.pending && e.hours !== null)
    .map((e) => e.hours as number);

  const total = entries.length;
  const reached = hours.length;
  const mean =
    reached === 0 ? null : round(hours.reduce((a, b) => a + b, 0) / reached, 2);

  return {
    total,
    reached,
    pending: total - reached,
    reachRate: round(safeRatio(reached, total)),
    medianHours: median(hours),
    meanHours: mean,
  };
}

/** KST(UTC+9) 기준 날짜 문자열(YYYY-MM-DD). 롤업 day 키. */
export function dayKeyKst(at: string | Date): string {
  const ms = at instanceof Date ? at.getTime() : parseAt(at);
  if (ms === null) return "";
  return new Date(ms + 9 * MS_PER_HOUR).toISOString().slice(0, 10);
}
