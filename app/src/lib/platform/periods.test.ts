import { describe, it, expect } from "vitest";
import {
  ANALYTICS_PERIODS,
  PERIOD_LABEL,
  changeRate,
  parsePeriod,
  periodRange,
  previousRange,
} from "./periods";
import {
  behaviorFromEnv,
  combineInsight,
  unavailableBehavior,
  type BehaviorMetrics,
} from "./insight";
import type { RevenueMetrics } from "./types";

const NOW = new Date("2026-07-29T12:00:00.000Z");

describe("기간 5구간 — 주·월·분기·반기·연", () => {
  it("belie 확정 5구간을 그대로 갖는다", () => {
    expect(ANALYTICS_PERIODS).toEqual(["week", "month", "quarter", "half", "year"]);
    expect(Object.values(PERIOD_LABEL)).toEqual(["주", "월", "분기", "반기", "연"]);
  });

  it("알 수 없는 값은 기본 'month' 로 좁힌다", () => {
    expect(parsePeriod("week")).toBe("week");
    expect(parsePeriod("decade")).toBe("month");
    expect(parsePeriod(undefined)).toBe("month");
  });

  it("구간은 오늘을 끝점으로 하는 되돌아보기 창이다", () => {
    const r = periodRange("week", NOW);
    expect(r.to).toBe("2026-07-29");
    expect(r.from).toBe("2026-07-23"); // 오늘 포함 7일
    expect(r.days).toBe(7);
  });

  it("연 구간은 365일이다", () => {
    expect(periodRange("year", NOW).days).toBe(365);
  });
});

describe("previousRange — 직전 동일 길이 구간", () => {
  it("현재 구간 바로 앞의 같은 길이 창을 낸다", () => {
    const prev = previousRange(periodRange("week", NOW));
    expect(prev.to).toBe("2026-07-22"); // from 하루 전
    expect(prev.from).toBe("2026-07-16");
  });
});

describe("changeRate", () => {
  it("증감률을 낸다", () => {
    expect(changeRate(120, 100)).toBeCloseTo(0.2);
    expect(changeRate(80, 100)).toBeCloseTo(-0.2);
  });

  it("직전이 0이면 정의 불가(null) — 0%나 무한대로 쓰지 않는다", () => {
    expect(changeRate(50, 0)).toBeNull();
  });
});

describe("종합 인사이트 — ①×②", () => {
  const revenue: RevenueMetrics = {
    mrr: 1_000_000,
    arr: 12_000_000,
    nrr: 1.1,
    outstanding: 0,
  };
  const behavior: BehaviorMetrics = {
    available: true,
    activeUsers: 100,
    sessions: 400,
    signups: 20,
    activated: 45,
    reason: "ok",
  };

  it("②가 있으면 ARPU·활성화율·가입당매출·사용자당세션을 낸다", () => {
    const i = combineInsight(revenue, behavior);
    expect(i.available).toBe(true);
    expect(i.arpu).toBe(10_000);
    expect(i.activationRate).toBeCloseTo(0.45);
    expect(i.revenuePerSignup).toBe(50_000);
    expect(i.sessionsPerUser).toBe(4);
  });

  it("확정값이 섞여도 결과는 추정으로 표기한다", () => {
    expect(combineInsight(revenue, behavior).confidence).toBe("estimated");
  });

  it("②가 없으면 계산하지 않는다 — 근거 없는 '종합'을 만들지 않는다", () => {
    const i = combineInsight(revenue, unavailableBehavior("키 없음"));
    expect(i.available).toBe(false);
    expect(i.arpu).toBeNull();
    expect(i.revenuePerSignup).toBeNull();
    expect(i.reason).toBe("키 없음");
  });

  it("분모가 0이면 null 이다 (0분모 방어)", () => {
    const i = combineInsight(revenue, { ...behavior, activeUsers: 0, signups: 0 });
    expect(i.arpu).toBeNull();
    expect(i.revenuePerSignup).toBeNull();
    expect(i.activationRate).toBe(0);
    expect(i.sessionsPerUser).toBe(0);
  });
});

describe("behaviorFromEnv — PostHog 서버 키", () => {
  it("서버 키가 없으면 미가용이고 사유를 밝힌다", () => {
    const b = behaviorFromEnv(undefined);
    expect(b.available).toBe(false);
    expect(b.reason).toContain("POSTHOG_QUERY_API_KEY");
  });

  it("미가용이어도 숫자는 0이라 화면이 NaN 을 만들지 않는다", () => {
    const b = behaviorFromEnv(undefined);
    expect(b.activeUsers).toBe(0);
    expect(Number.isFinite(b.sessions)).toBe(true);
  });
});
