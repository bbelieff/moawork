import { describe, expect, it } from "vitest";
import {
  buildDailyRollup,
  buildDailyRollups,
  countCreatedOnDay,
  kstDayEndUtc,
  kstDayStartUtc,
  platformTotals,
  type RollupInput,
} from "./rollup";
import type { ActivityEvent } from "./types";

const ORG = "org-1";

function ev(actorId: string | null, at: string, orgId = ORG): ActivityEvent {
  return { orgId, actorId, at };
}

describe("KST 하루 경계", () => {
  it("KST 자정 = UTC 전날 15시", () => {
    expect(kstDayStartUtc("2026-07-27")).toBe("2026-07-26T15:00:00.000Z");
    expect(kstDayEndUtc("2026-07-27")).toBe("2026-07-27T15:00:00.000Z");
  });

  it("잘못된 날짜 형식은 null", () => {
    expect(kstDayStartUtc("2026-7-27")).toBeNull();
    expect(kstDayStartUtc("어제")).toBeNull();
    expect(kstDayEndUtc("")).toBeNull();
  });
});

describe("countCreatedOnDay — 반열린 구간", () => {
  it("KST 하루 안의 건수만 센다", () => {
    const ats = [
      "2026-07-26T15:00:00.000Z", // KST 7/27 00:00 정각 → 포함
      "2026-07-27T03:00:00.000Z", // KST 7/27 12:00 → 포함
      "2026-07-27T14:59:59.000Z", // KST 7/27 23:59:59 → 포함
      "2026-07-27T15:00:00.000Z", // KST 7/28 00:00 정각 → 제외
      "2026-07-26T14:59:59.000Z", // KST 7/26 23:59:59 → 제외
    ];
    expect(countCreatedOnDay(ats, "2026-07-27")).toBe(3);
  });

  it("잘못된 값은 건너뛴다", () => {
    expect(countCreatedOnDay(["쓰레기", ""], "2026-07-27")).toBe(0);
  });
});

/**
 * 수용기준: 더미 데이터를 **손으로 센 값**과 롤업 결과가 일치해야 한다.
 * 아래 픽스처는 각 기대값의 근거를 주석으로 남긴다.
 */
describe("수용기준 — 더미 데이터 수동 카운트 일치", () => {
  // 집계 대상: KST 2026-07-27 (= UTC 2026-07-26T15:00 ~ 2026-07-27T15:00)
  const day = "2026-07-27";

  // 멤버 5명: u1..u5
  const memberIds = ["u1", "u2", "u3", "u4", "u5"];

  const events: ActivityEvent[] = [
    // ── 당일(DAU 창) 활동 ──
    ev("u1", "2026-07-27T01:00:00.000Z"), // KST 7/27 10:00
    ev("u1", "2026-07-27T02:00:00.000Z"), // 같은 사람 중복 → DAU 1명으로
    ev("u2", "2026-07-27T05:00:00.000Z"), // KST 7/27 14:00
    // ── 30일 창 안이지만 당일 아님 ──
    ev("u3", "2026-07-10T00:00:00.000Z"), // 17일 전 → MAU O, DAU X
    ev("u4", "2026-07-05T00:00:00.000Z"), // 22일 전 → MAU O, DAU X
    // ── 30일 창 밖 ──
    ev("u5", "2026-05-01T00:00:00.000Z"), // 87일 전 → MAU X, 휴면
    // ── 잡음: 시스템 이벤트 + 타 조직 + 깨진 시각 ──
    ev(null, "2026-07-27T03:00:00.000Z"), // actor 없음 → 사용자 아님
    ev("u9", "2026-07-27T03:00:00.000Z", "org-2"), // 타 조직 → 제외
    ev("u1", "쓰레기"), // 파싱 불가 → 무시
  ];

  const dealCreatedAts = [
    "2026-07-27T02:00:00.000Z", // 당일 → 카운트
    "2026-07-27T10:00:00.000Z", // 당일 → 카운트
    "2026-07-20T02:00:00.000Z", // 다른 날 → 제외
  ];

  const input: RollupInput = { orgId: ORG, day, events, memberIds, dealCreatedAts };

  it("DAU = 당일 활동한 고유 사용자 = u1, u2 = 2", () => {
    expect(buildDailyRollup(input).dau).toBe(2);
  });

  it("MAU = 최근 30일 고유 사용자 = u1, u2, u3, u4 = 4", () => {
    // u5(87일 전)는 창 밖, null actor 와 타 조직은 제외.
    expect(buildDailyRollup(input).mau).toBe(4);
  });

  it("stickiness = DAU/MAU = 2/4 = 0.5", () => {
    expect(buildDailyRollup(input).stickiness).toBe(0.5);
  });

  it("활성 = 30일 내 활동한 멤버 = u1, u2, u3, u4 = 4", () => {
    expect(buildDailyRollup(input).activeUsers).toBe(4);
  });

  it("휴면 = 활동 이력은 있으나 30일 경과 = u5 = 1", () => {
    expect(buildDailyRollup(input).dormantUsers).toBe(1);
  });

  it("신규 딜 = 당일 생성 = 2", () => {
    expect(buildDailyRollup(input).newDeals).toBe(2);
  });

  it("전체 행이 수동 카운트와 정확히 일치한다", () => {
    expect(buildDailyRollup(input)).toEqual({
      day: "2026-07-27",
      orgId: ORG,
      dau: 2,
      mau: 4,
      stickiness: 0.5,
      activeUsers: 4,
      dormantUsers: 1,
      newDeals: 2,
    });
  });

  it("활성 + 휴면 + 미활성 = 전체 멤버 수 (누락 없음)", () => {
    const r = buildDailyRollup(input);
    const neverActive = memberIds.length - r.activeUsers - r.dormantUsers;
    expect(neverActive).toBe(0);
    expect(r.activeUsers + r.dormantUsers + neverActive).toBe(memberIds.length);
  });
});

describe("MAU 창 입력 요구사항", () => {
  it("하루치 이벤트만 넘기면 MAU=DAU 가 되어 stickiness 가 1 이 된다(주석의 경고를 고정)", () => {
    const oneDayOnly = [ev("u1", "2026-07-27T01:00:00.000Z")];
    const r = buildDailyRollup({
      orgId: ORG,
      day: "2026-07-27",
      events: oneDayOnly,
      memberIds: ["u1"],
      dealCreatedAts: [],
    });
    expect(r.dau).toBe(1);
    expect(r.mau).toBe(1);
    expect(r.stickiness).toBe(1);
  });
});

describe("경계·방어", () => {
  it("이벤트·멤버가 없으면 전부 0 (0분모 방어)", () => {
    expect(
      buildDailyRollup({
        orgId: ORG,
        day: "2026-07-27",
        events: [],
        memberIds: [],
        dealCreatedAts: [],
      }),
    ).toEqual({
      day: "2026-07-27",
      orgId: ORG,
      dau: 0,
      mau: 0,
      stickiness: 0,
      activeUsers: 0,
      dormantUsers: 0,
      newDeals: 0,
    });
  });

  it("잘못된 day 는 던지지 않고 0 행을 돌려준다(배치 중단 방지)", () => {
    const r = buildDailyRollup({
      orgId: ORG,
      day: "엉터리",
      events: [ev("u1", "2026-07-27T01:00:00.000Z")],
      memberIds: ["u1"],
      dealCreatedAts: [],
    });
    expect(r.dau).toBe(0);
    expect(r.stickiness).toBe(0);
  });

  it("휴면 임계를 조정할 수 있다", () => {
    const events = [ev("u1", "2026-07-20T00:00:00.000Z")]; // 7일 전
    const base = { orgId: ORG, day: "2026-07-27", events, memberIds: ["u1"], dealCreatedAts: [] };
    expect(buildDailyRollup({ ...base, dormantDays: 30 }).dormantUsers).toBe(0);
    expect(buildDailyRollup({ ...base, dormantDays: 5 }).dormantUsers).toBe(1);
  });
});

describe("buildDailyRollups — 조직별 격리", () => {
  it("조직마다 자기 이벤트만 집계한다", () => {
    const events = [
      ev("a1", "2026-07-27T01:00:00.000Z", "org-A"),
      ev("b1", "2026-07-27T01:00:00.000Z", "org-B"),
      ev("b2", "2026-07-27T02:00:00.000Z", "org-B"),
    ];
    const rows = buildDailyRollups([
      { orgId: "org-A", day: "2026-07-27", events, memberIds: ["a1"], dealCreatedAts: [] },
      { orgId: "org-B", day: "2026-07-27", events, memberIds: ["b1", "b2"], dealCreatedAts: [] },
    ]);
    expect(rows.map((r) => r.dau)).toEqual([1, 2]);
  });
});

describe("platformTotals", () => {
  const rows = [
    { day: "2026-07-27", orgId: "A", dau: 2, mau: 4, stickiness: 0.5, activeUsers: 4, dormantUsers: 1, newDeals: 2 },
    { day: "2026-07-27", orgId: "B", dau: 1, mau: 6, stickiness: 0.1667, activeUsers: 6, dormantUsers: 0, newDeals: 3 },
  ];

  it("합계는 단순 합", () => {
    const t = platformTotals(rows);
    expect(t).toMatchObject({
      orgs: 2,
      dauSum: 3,
      mauSum: 10,
      activeUsers: 10,
      dormantUsers: 1,
      newDeals: 5,
    });
  });

  it("stickiness 는 비율의 평균이 아니라 합계로 재계산한다", () => {
    // 평균이면 (0.5 + 0.1667)/2 = 0.333…, 재계산이면 3/10 = 0.3
    expect(platformTotals(rows).stickiness).toBe(0.3);
  });

  it("빈 입력도 안전", () => {
    expect(platformTotals([])).toMatchObject({ orgs: 0, dauSum: 0, stickiness: 0 });
  });
});
