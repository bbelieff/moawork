// T07 · 플랫폼 지표 산식(순수 함수).
//
// 입력은 전부 호출부가 주입한다(RPC 조회 결과) — 이 파일은 I/O 를 하지 않는다.
// 저장 원본은 `platform_metrics_daily`(야간 배치 롤업)이며, **실시간 집계는 하지 않는다**.
// 여기서 다루는 값은 전부 수치다 — 고객 업무 데이터의 내용은 들어오지 않는다.
//
// 내부 조직(is_internal) 제외는 SQL 단계(platform_org_overview / platform_metrics_range 의
// p_include_internal)에서 이미 걸러진 채로 들어온다. 이름·slug 로 내부 여부를 추정하지 않는다.

import type {
  ActivityMetrics,
  BillingMonthRow,
  HealthMetrics,
  InputMetrics,
  MetricsDailyRow,
  OrgHealth,
  OrgListEntry,
  OrgOverviewRow,
  RevenueMetrics,
  TtfvInput,
  TtfvMetrics,
} from "./types";

/** 휴면 판정 기준 — 14일 무활동. */
export const DORMANT_DAYS = 14;
/** 둔화 판정 기준 — 7일 무활동(휴면 미만). */
export const SLOWING_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/** 0분모 방어 나눗셈. total<=0 이면 0. */
export function ratio(part: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return part / total;
}

/** ISO 문자열 → epoch ms. 파싱 불가면 null. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** 마지막 활동 이후 경과 일수. 활동 이력이 없으면 null. */
export function idleDaysSince(
  lastActivityAt: string | null,
  now: Date = new Date(),
): number | null {
  const t = parseTime(lastActivityAt);
  if (t === null) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY));
}

/**
 * 조직 활동 상태.
 * 활동 이력이 아예 없으면 휴면으로 본다(가입만 하고 안 쓰는 조직이 가장 손볼 대상).
 */
export function classifyHealth(
  lastActivityAt: string | null,
  now: Date = new Date(),
): OrgHealth {
  const idle = idleDaysSince(lastActivityAt, now);
  if (idle === null || idle >= DORMANT_DAYS) return "dormant";
  if (idle >= SLOWING_DAYS) return "slowing";
  return "active";
}

/** 위험순 서열 — 낮을수록 위험(먼저 나온다). */
const HEALTH_RISK: Record<OrgHealth, number> = {
  dormant: 0,
  slowing: 1,
  active: 2,
};

/**
 * 회사 목록을 **위험순**으로 정렬한다 — 휴면 → 둔화 → 활발.
 * 운영자가 콘솔을 열면 손볼 회사가 맨 위에 오게 하는 것이 목적이다.
 *
 * 같은 상태 안에서는 더 오래 놀고 있는 쪽(idleDays 큰 쪽)이 위,
 * 그다음 규모가 큰 쪽(멤버 수)이 위 — 방치 시 손실이 큰 순서.
 * 마지막 tie-break 은 이름 오름차순이라 렌더가 요청마다 흔들리지 않는다.
 */
export function sortByRisk(
  rows: readonly OrgOverviewRow[],
  now: Date = new Date(),
): OrgListEntry[] {
  return rows
    .map((row): OrgListEntry => {
      const idleDays = idleDaysSince(row.lastActivityAt, now);
      return {
        ...row,
        health: classifyHealth(row.lastActivityAt, now),
        idleDays,
        activeRatio: ratio(row.activeUsers7d, row.memberCount),
      };
    })
    .sort((a, b) => {
      const risk = HEALTH_RISK[a.health] - HEALTH_RISK[b.health];
      if (risk !== 0) return risk;
      // 활동 이력이 없는(null) 쪽을 가장 위험하게 본다.
      const aIdle = a.idleDays ?? Number.POSITIVE_INFINITY;
      const bIdle = b.idleDays ?? Number.POSITIVE_INFINITY;
      if (aIdle !== bIdle) return bIdle - aIdle;
      if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
      return a.name.localeCompare(b.name, "ko");
    });
}

/** 날짜 문자열(YYYY-MM-DD)이 [from, to] 안인가. 문자열 비교로 충분(ISO 날짜). */
function inDateRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/** `now` 로부터 n일 전 날짜(YYYY-MM-DD, UTC 기준). */
export function daysAgo(n: number, now: Date = new Date()): string {
  return new Date(now.getTime() - n * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * 활성 지표 — DAU / WAU / MAU + 스티키니스.
 *
 * 일별 롤업에는 조직별 고유 사용자 수만 있고 **사용자 ID 는 없다**(개인정보 최소화).
 * 따라서 기간 집계는 "그 기간 중 하루 최대 동시 활성자 수"로 근사한다 —
 * 조직별 max 를 합산하는 방식이라 과대집계를 피한다(합집합의 상한이 아닌 보수적 추정).
 */
export function activityMetrics(
  rows: readonly MetricsDailyRow[],
  now: Date = new Date(),
): ActivityMetrics {
  const today = daysAgo(0, now);
  const peakPerOrg = (from: string): number => {
    const byOrg = new Map<string, number>();
    for (const r of rows) {
      if (!inDateRange(r.date, from, today)) continue;
      byOrg.set(r.orgId, Math.max(byOrg.get(r.orgId) ?? 0, r.activeUsers));
    }
    let sum = 0;
    for (const v of byOrg.values()) sum += v;
    return sum;
  };

  const dau = peakPerOrg(today);
  const wau = peakPerOrg(daysAgo(6, now));
  const mau = peakPerOrg(daysAgo(29, now));
  return { dau, wau, mau, stickiness: ratio(dau, mau) };
}

/** 입력량 지표 — 쓰기 총합과 조직별 일평균. */
export function inputMetrics(rows: readonly MetricsDailyRow[]): InputMetrics {
  let writes = 0;
  const orgs = new Set<string>();
  const days = new Set<string>();
  for (const r of rows) {
    writes += r.writes;
    orgs.add(r.orgId);
    days.add(r.date);
  }
  const denominator = orgs.size * days.size;
  return {
    writes,
    writesPerOrgPerDay: ratio(writes, denominator),
    days: days.size,
    orgCount: orgs.size,
  };
}

/** 숫자 배열의 중앙값. 빈 배열이면 null. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * TTFV — 가입(orgs.created_at) → 첫 딜 등록(min deals.created_at)까지 시간.
 * 첫 딜이 없는 조직은 **미전환**으로 분리한다(0시간으로 넣으면 평균이 왜곡된다).
 * 첫 딜이 가입보다 앞선 비정상 데이터는 제외한다.
 */
export function ttfvMetrics(inputs: readonly TtfvInput[]): TtfvMetrics {
  const hours: number[] = [];
  for (const i of inputs) {
    const signed = parseTime(i.signedUpAt);
    const first = parseTime(i.firstDealAt);
    if (signed === null || first === null) continue;
    const delta = first - signed;
    if (delta < 0) continue;
    hours.push(delta / MS_PER_HOUR);
  }
  const mean =
    hours.length > 0 ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
  return {
    converted: hours.length,
    total: inputs.length,
    medianHours: median(hours),
    meanHours: mean,
  };
}

/**
 * 리텐션 — 가입 후 N주차에 활동이 있었던 조직 비율.
 * 코호트가 비어 있으면 0(0분모 방어).
 */
export function retentionRate(
  orgs: readonly { orgId: string; createdAt: string }[],
  rows: readonly MetricsDailyRow[],
  weekIndex: number,
  now: Date = new Date(),
): number {
  const activeDays = new Map<string, string[]>();
  for (const r of rows) {
    if (r.activeUsers <= 0 && r.writes <= 0) continue;
    const list = activeDays.get(r.orgId);
    if (list) list.push(r.date);
    else activeDays.set(r.orgId, [r.date]);
  }

  let cohort = 0;
  let retained = 0;
  for (const org of orgs) {
    const signed = parseTime(org.createdAt);
    if (signed === null) continue;
    const windowStart = signed + weekIndex * 7 * MS_PER_DAY;
    const windowEnd = windowStart + 7 * MS_PER_DAY;
    // 아직 그 주차가 오지 않은 조직은 코호트에서 뺀다(미도래를 이탈로 세면 왜곡).
    if (windowEnd > now.getTime()) continue;
    cohort += 1;
    const days = activeDays.get(org.orgId) ?? [];
    const hit = days.some((d) => {
      const t = parseTime(d);
      return t !== null && t >= windowStart && t < windowEnd;
    });
    if (hit) retained += 1;
  }
  return ratio(retained, cohort);
}

/** 건강도 지표 묶음. */
export function healthMetrics(
  orgs: readonly OrgOverviewRow[],
  rows: readonly MetricsDailyRow[],
  pendingRequests: number,
  now: Date = new Date(),
): HealthMetrics {
  const dormantOrgs = orgs.filter(
    (o) => classifyHealth(o.lastActivityAt, now) === "dormant",
  ).length;

  let writes = 0;
  let errors = 0;
  for (const r of rows) {
    writes += r.writes;
    errors += r.errors;
  }

  const cohort = orgs.map((o) => ({ orgId: o.orgId, createdAt: o.createdAt }));
  return {
    dormantOrgs,
    errorRate: ratio(errors, writes),
    pendingRequests,
    retentionW1: retentionRate(cohort, rows, 1, now),
    retentionW4: retentionRate(cohort, rows, 4, now),
  };
}

/**
 * 매출 지표 — MRR / ARR / NRR / 미수금.
 *
 * MRR 은 **공급가액**(부가세 제외) 기준이다. 부가세는 대납분이라 매출이 아니다.
 * 행은 월 오름차순으로 정렬해 마지막 두 달을 비교한다(입력 순서에 의존하지 않는다).
 */
export function revenueMetrics(rows: readonly BillingMonthRow[]): RevenueMetrics {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const last = sorted.at(-1);
  const prev = sorted.at(-2);

  const mrr = last?.supplySum ?? 0;
  const prevMrr = prev?.supplySum ?? 0;

  let billed = 0;
  let paid = 0;
  for (const r of sorted) {
    billed += r.totalSum;
    paid += r.paidSum;
  }

  return {
    mrr,
    arr: mrr * 12,
    // 전월 매출 0 은 "유지율 0%"가 아니라 **정의 불가**다. null 로 두고 화면은 '—'.
    nrr: prevMrr > 0 ? mrr / prevMrr : null,
    outstanding: Math.max(0, billed - paid),
  };
}
