import { describe, expect, it } from "vitest";
import {
  DEFAULT_DORMANT_DAYS,
  dayKeyKst,
  dormancy,
  dormancyBreakdown,
  lastActiveByActor,
  median,
  parseAt,
  safeRatio,
  stickiness,
  ttfv,
  ttfvSummary,
  uniqueActorsInWindow,
} from "./compute";
import type { ActivityEvent } from "./types";

const ORG = "org-1";
const AS_OF = "2026-07-28T00:00:00.000Z";

function ev(actorId: string | null, at: string): ActivityEvent {
  return { orgId: ORG, actorId, at };
}

describe("parseAt — 입력 신뢰 금지", () => {
  it("유효 ISO 를 epoch 로", () => {
    expect(parseAt("2026-07-28T00:00:00.000Z")).toBe(Date.parse(AS_OF));
  });

  it("빈값·비문자열·잘못된 형식은 null", () => {
    expect(parseAt(null)).toBeNull();
    expect(parseAt(undefined)).toBeNull();
    expect(parseAt("")).toBeNull();
    expect(parseAt("어제")).toBeNull();
    expect(parseAt("2026-13-45")).toBeNull();
  });
});

describe("safeRatio — 0분모 방어", () => {
  it("정상 비율", () => {
    expect(safeRatio(1, 4)).toBe(0.25);
  });
  it("분모 0/음수는 0", () => {
    expect(safeRatio(5, 0)).toBe(0);
    expect(safeRatio(5, -1)).toBe(0);
  });
});

describe("uniqueActorsInWindow — 반열린 구간", () => {
  const events = [
    ev("u1", "2026-07-27T12:00:00.000Z"), // 창 안
    ev("u1", "2026-07-27T13:00:00.000Z"), // 같은 사용자 중복
    ev("u2", "2026-07-27T23:59:59.000Z"), // 창 안
  ];

  it("고유 사용자만 센다(중복 제거)", () => {
    expect(uniqueActorsInWindow(events, Date.parse(AS_OF), 1).size).toBe(2);
  });

  it("창 시작은 포함, 끝은 제외 [start, asOf)", () => {
    const start = ev("u3", "2026-07-27T00:00:00.000Z"); // asOf-1일 정각 = 포함
    const end = ev("u4", AS_OF); // asOf 정각 = 제외
    const set = uniqueActorsInWindow([start, end], Date.parse(AS_OF), 1);
    expect(set.has("u3")).toBe(true);
    expect(set.has("u4")).toBe(false);
  });

  it("actorId=null(시스템 이벤트)은 사용자로 세지 않는다", () => {
    expect(uniqueActorsInWindow([ev(null, "2026-07-27T12:00:00.000Z")], Date.parse(AS_OF), 1).size).toBe(0);
  });

  it("잘못된 at 은 건너뛴다(집계가 죽지 않음)", () => {
    expect(uniqueActorsInWindow([ev("u9", "쓰레기")], Date.parse(AS_OF), 1).size).toBe(0);
  });
});

describe("stickiness — DAU/MAU", () => {
  it("DAU 는 MAU 의 부분집합이라 ratio 는 0..1", () => {
    const events = [
      ev("u1", "2026-07-27T12:00:00.000Z"), // 오늘 활성
      ev("u2", "2026-07-10T12:00:00.000Z"), // 월간만
      ev("u3", "2026-07-05T12:00:00.000Z"), // 월간만
      ev("u4", "2026-07-01T12:00:00.000Z"), // 월간만
    ];
    const s = stickiness(events, AS_OF);
    expect(s.dau).toBe(1);
    expect(s.mau).toBe(4);
    expect(s.ratio).toBe(0.25);
    expect(s.ratio).toBeGreaterThanOrEqual(0);
    expect(s.ratio).toBeLessThanOrEqual(1);
  });

  it("MAU 창(30일) 밖은 제외된다", () => {
    const s = stickiness([ev("old", "2026-05-01T00:00:00.000Z")], AS_OF);
    expect(s.mau).toBe(0);
    expect(s.ratio).toBe(0);
  });

  it("이벤트 없으면 전부 0 (0분모 방어)", () => {
    const s = stickiness([], AS_OF);
    expect(s).toMatchObject({ dau: 0, mau: 0, ratio: 0 });
  });

  it("전원 매일 활성이면 ratio=1", () => {
    const events = [ev("u1", "2026-07-27T12:00:00.000Z"), ev("u2", "2026-07-27T13:00:00.000Z")];
    expect(stickiness(events, AS_OF).ratio).toBe(1);
  });

  it("잘못된 asOf 는 던지지 않고 빈 지표", () => {
    const s = stickiness([ev("u1", "2026-07-27T12:00:00.000Z")], "쓰레기");
    expect(s).toMatchObject({ dau: 0, mau: 0, ratio: 0 });
  });

  it("창 크기를 바꿀 수 있다(주간 스티키니스)", () => {
    const events = [ev("u1", "2026-07-25T12:00:00.000Z")];
    expect(stickiness(events, AS_OF, { dauWindowDays: 7 }).dau).toBe(1);
    expect(stickiness(events, AS_OF, { dauWindowDays: 1 }).dau).toBe(0);
  });
});

describe("dormancy — 휴면 vs 미활성 구분", () => {
  it("임계 미만이면 활성", () => {
    const v = dormancy("2026-07-20T00:00:00.000Z", AS_OF, 30);
    expect(v.dormant).toBe(false);
    expect(v.neverActive).toBe(false);
    expect(v.daysSinceLastActive).toBe(8);
  });

  it("임계 경계값(정확히 N일)은 휴면으로 판정", () => {
    const v = dormancy("2026-06-28T00:00:00.000Z", AS_OF, 30);
    expect(v.daysSinceLastActive).toBe(30);
    expect(v.dormant).toBe(true);
  });

  it("활동 이력 없음은 휴면이 아니라 미활성", () => {
    const v = dormancy(null, AS_OF);
    expect(v.neverActive).toBe(true);
    expect(v.dormant).toBe(false);
    expect(v.daysSinceLastActive).toBeNull();
  });

  it("미래 시각은 음수 일수가 되지 않는다(시계 오차 방어)", () => {
    const v = dormancy("2026-08-01T00:00:00.000Z", AS_OF);
    expect(v.daysSinceLastActive).toBe(0);
    expect(v.dormant).toBe(false);
  });

  it("기본 임계는 30일", () => {
    expect(dormancy("2026-07-20T00:00:00.000Z", AS_OF).thresholdDays).toBe(DEFAULT_DORMANT_DAYS);
  });
});

describe("lastActiveByActor", () => {
  it("사용자별 가장 늦은 활동을 고른다", () => {
    const map = lastActiveByActor([
      ev("u1", "2026-07-01T00:00:00.000Z"),
      ev("u1", "2026-07-20T00:00:00.000Z"),
      ev("u1", "2026-07-10T00:00:00.000Z"),
    ]);
    expect(map.get("u1")).toBe(Date.parse("2026-07-20T00:00:00.000Z"));
  });
});

describe("dormancyBreakdown — 조직 분포", () => {
  it("활성/휴면/미활성을 각각 센다", () => {
    const members = ["u1", "u2", "u3"];
    const events = [
      ev("u1", "2026-07-27T00:00:00.000Z"), // 활성
      ev("u2", "2026-05-01T00:00:00.000Z"), // 휴면
      // u3 는 이벤트 없음 → 미활성
    ];
    const b = dormancyBreakdown(members, events, AS_OF, 30);
    expect(b).toMatchObject({ total: 3, active: 1, dormant: 1, neverActive: 1 });
    expect(b.dormantRatio).toBeCloseTo(1 / 3, 3);
  });

  it("멤버 0명이면 비율 0(0분모 방어)", () => {
    expect(dormancyBreakdown([], [], AS_OF).dormantRatio).toBe(0);
  });

  it("이벤트에만 있고 멤버가 아닌 actor 는 집계에 넣지 않는다", () => {
    const b = dormancyBreakdown(["u1"], [ev("유령", "2026-07-27T00:00:00.000Z")], AS_OF);
    expect(b.total).toBe(1);
    expect(b.neverActive).toBe(1);
  });
});

describe("ttfv — 첫 가치 실현", () => {
  it("소요 시간을 시간 단위로 계산", () => {
    const e = ttfv(ORG, "2026-07-01T00:00:00.000Z", "2026-07-02T12:00:00.000Z");
    expect(e.hours).toBe(36);
    expect(e.pending).toBe(false);
  });

  it("미도달은 pending", () => {
    const e = ttfv(ORG, "2026-07-01T00:00:00.000Z", null);
    expect(e.pending).toBe(true);
    expect(e.hours).toBeNull();
  });

  it("도달이 기산점보다 이른 이상 데이터는 pending 으로 처리(음수 금지)", () => {
    const e = ttfv(ORG, "2026-07-10T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    expect(e.pending).toBe(true);
    expect(e.hours).toBeNull();
  });

  it("같은 시각이면 0시간(즉시 도달)", () => {
    const e = ttfv(ORG, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    expect(e.hours).toBe(0);
    expect(e.pending).toBe(false);
  });
});

describe("median", () => {
  it("홀수 개는 가운데", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("짝수 개는 두 값의 평균", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("빈 배열은 null", () => {
    expect(median([])).toBeNull();
  });
});

describe("ttfvSummary — 미도달 제외 + reachRate 동반", () => {
  it("도달 건만 평균/중앙값에 넣고 pending 은 따로 센다", () => {
    const entries = [
      ttfv("o1", "2026-07-01T00:00:00.000Z", "2026-07-01T10:00:00.000Z"), // 10h
      ttfv("o2", "2026-07-01T00:00:00.000Z", "2026-07-01T20:00:00.000Z"), // 20h
      ttfv("o3", "2026-07-01T00:00:00.000Z", null), // pending
    ];
    const s = ttfvSummary(entries);
    expect(s).toMatchObject({ total: 3, reached: 2, pending: 1 });
    expect(s.medianHours).toBe(15);
    expect(s.meanHours).toBe(15);
    expect(s.reachRate).toBeCloseTo(2 / 3, 3);
  });

  it("도달 0건이면 중앙값·평균은 null (허위 0 금지)", () => {
    const s = ttfvSummary([ttfv("o1", "2026-07-01T00:00:00.000Z", null)]);
    expect(s.medianHours).toBeNull();
    expect(s.meanHours).toBeNull();
    expect(s.reachRate).toBe(0);
  });

  it("빈 코호트도 안전", () => {
    expect(ttfvSummary([])).toMatchObject({ total: 0, reached: 0, reachRate: 0 });
  });
});

describe("dayKeyKst — KST 하루 경계", () => {
  it("UTC 늦은 밤은 KST 다음날", () => {
    expect(dayKeyKst("2026-07-27T15:30:00.000Z")).toBe("2026-07-28");
  });
  it("UTC 이른 시각은 같은 날", () => {
    expect(dayKeyKst("2026-07-27T00:30:00.000Z")).toBe("2026-07-27");
  });
  it("잘못된 입력은 빈 문자열", () => {
    expect(dayKeyKst("쓰레기")).toBe("");
  });
});
