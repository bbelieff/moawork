// T07 · 운영 분석 기간 구간(순수 함수).
//
// belie 확정: 주 · 월 · 분기 · 반기 · 연 5구간.
// 모든 구간은 **오늘을 끝점으로 하는 되돌아보기 창**이다(달력 경계 정렬이 아니라).
// 달력 정렬(이번 달 1일~)로 잡으면 월초에 표본이 며칠뿐이라 지표가 요동친다.

export const ANALYTICS_PERIODS = ["week", "month", "quarter", "half", "year"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const PERIOD_LABEL: Record<AnalyticsPeriod, string> = {
  week: "주",
  month: "월",
  quarter: "분기",
  half: "반기",
  year: "연",
};

/** 구간별 되돌아보기 일수. */
export const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  week: 7,
  month: 30,
  quarter: 91,
  half: 182,
  year: 365,
};

/** 구간별 청구 조회 개월 수 — 매출 지표의 입력 범위. */
export const PERIOD_MONTHS: Record<AnalyticsPeriod, number> = {
  week: 2, // 전월 대비(NRR)를 내려면 최소 2개월
  month: 2,
  quarter: 4,
  half: 7,
  year: 13,
};

/** 임의 값을 구간으로 좁힌다. 알 수 없으면 기본 'month'. */
export function parsePeriod(value: string | undefined): AnalyticsPeriod {
  return (ANALYTICS_PERIODS as readonly string[]).includes(value ?? "")
    ? (value as AnalyticsPeriod)
    : "month";
}

export interface PeriodRange {
  period: AnalyticsPeriod;
  label: string;
  /** 포함 시작일 (YYYY-MM-DD). */
  from: string;
  /** 포함 종료일 (YYYY-MM-DD). */
  to: string;
  days: number;
}

/** 구간 → 날짜 범위. 끝점은 오늘이다. */
export function periodRange(
  period: AnalyticsPeriod,
  now: Date = new Date(),
): PeriodRange {
  const days = PERIOD_DAYS[period];
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { period, label: PERIOD_LABEL[period], from, to, days };
}

/**
 * 직전 동일 길이 구간 — 증감 비교용.
 * 예) 최근 30일이 [from,to] 면 그 직전 30일을 돌려준다.
 */
export function previousRange(range: PeriodRange): { from: string; to: string } {
  const fromMs = Date.parse(`${range.from}T00:00:00.000Z`);
  const prevTo = new Date(fromMs - 86_400_000);
  const prevFrom = new Date(fromMs - range.days * 86_400_000);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

/**
 * 증감률 — (현재 − 직전) ÷ 직전.
 * 직전이 0이면 **정의 불가(null)** 다. 0에서 늘어난 것을 "+∞%" 나 "0%" 로 쓰면 오해를 부른다.
 */
export function changeRate(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}
