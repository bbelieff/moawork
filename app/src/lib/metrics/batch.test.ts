import { describe, expect, it } from "vitest";
import { previousDayKst, runDailyRollup, type MetricsSink, type MetricsSource } from "./batch";
import type { ActivityEvent, DailyRollup } from "./types";

/** 인메모리 소스 — 배치 로직을 저장소 없이 검증한다. */
function fakeSource(data: {
  orgIds: string[];
  members: Record<string, string[]>;
  events: ActivityEvent[];
  deals: Record<string, string[]>;
  failOn?: string;
}): MetricsSource & { eventWindows: { from: string; to: string }[] } {
  const eventWindows: { from: string; to: string }[] = [];
  return {
    eventWindows,
    async listOrgIds() {
      return data.orgIds;
    },
    async listMemberIds(orgId) {
      if (orgId === data.failOn) throw new Error("멤버 조회 실패");
      return data.members[orgId] ?? [];
    },
    async listEvents(orgId, from, to) {
      eventWindows.push({ from, to });
      const fromMs = Date.parse(from);
      const toMs = Date.parse(to);
      return data.events.filter((e) => {
        if (e.orgId !== orgId) return false;
        const ms = Date.parse(e.at);
        return Number.isFinite(ms) && ms >= fromMs && ms < toMs;
      });
    },
    async listDealCreatedAts(orgId, from, to) {
      const fromMs = Date.parse(from);
      const toMs = Date.parse(to);
      return (data.deals[orgId] ?? []).filter((at) => {
        const ms = Date.parse(at);
        return Number.isFinite(ms) && ms >= fromMs && ms < toMs;
      });
    },
  };
}

function fakeSink(): MetricsSink & { rows: DailyRollup[] } {
  const rows: DailyRollup[] = [];
  return {
    rows,
    async upsert(row) {
      // 멱등: 같은 day+org 는 덮어쓴다(DB on conflict 와 동일 의미).
      const i = rows.findIndex((r) => r.day === row.day && r.orgId === row.orgId);
      if (i >= 0) rows[i] = row;
      else rows.push(row);
    },
  };
}

const DAY = "2026-07-27";

describe("previousDayKst — 야간 배치는 완료된 하루를 집계", () => {
  it("KST 기준 어제를 고른다", () => {
    // 2026-07-28T00:30Z = KST 09:30 → 어제 = 7/27
    expect(previousDayKst(new Date("2026-07-28T00:30:00.000Z"))).toBe("2026-07-27");
  });

  it("UTC 늦은 밤(=KST 다음날 아침)도 KST 기준으로 판정", () => {
    // 2026-07-27T16:00Z = KST 7/28 01:00 → 어제 = 7/27
    expect(previousDayKst(new Date("2026-07-27T16:00:00.000Z"))).toBe("2026-07-27");
  });
});

describe("runDailyRollup", () => {
  it("조직별로 한 행씩 적재한다", async () => {
    const source = fakeSource({
      orgIds: ["org-A", "org-B"],
      members: { "org-A": ["a1", "a2"], "org-B": ["b1"] },
      events: [
        { orgId: "org-A", actorId: "a1", at: "2026-07-27T01:00:00.000Z" },
        { orgId: "org-B", actorId: "b1", at: "2026-07-27T02:00:00.000Z" },
      ],
      deals: { "org-A": ["2026-07-27T03:00:00.000Z"] },
    });
    const sink = fakeSink();

    const res = await runDailyRollup(source, sink, { day: DAY });

    expect(res.day).toBe(DAY);
    expect(res.rows).toHaveLength(2);
    expect(res.failures).toHaveLength(0);
    expect(sink.rows.map((r) => r.orgId)).toEqual(["org-A", "org-B"]);
    expect(sink.rows[0].dau).toBe(1);
    expect(sink.rows[0].newDeals).toBe(1);
    expect(sink.rows[1].dau).toBe(1);
  });

  it("이벤트 조회 창이 MAU(30일)를 덮는다", async () => {
    const source = fakeSource({ orgIds: ["org-A"], members: {}, events: [], deals: {} });
    await runDailyRollup(source, fakeSink(), { day: DAY });

    const w = source.eventWindows[0];
    const spanDays = (Date.parse(w.to) - Date.parse(w.from)) / (24 * 60 * 60 * 1000);
    // 하루치 + 30일 창 = 31일
    expect(spanDays).toBe(31);
    expect(w.to).toBe("2026-07-27T15:00:00.000Z"); // KST 7/28 00:00
  });

  it("30일 창의 과거 이벤트가 MAU 에 반영된다(하루치만 읽지 않는다)", async () => {
    const source = fakeSource({
      orgIds: ["org-A"],
      members: { "org-A": ["u1", "u2"] },
      events: [
        { orgId: "org-A", actorId: "u1", at: "2026-07-27T01:00:00.000Z" }, // 당일
        { orgId: "org-A", actorId: "u2", at: "2026-07-10T01:00:00.000Z" }, // 17일 전
      ],
      deals: {},
    });
    const sink = fakeSink();
    await runDailyRollup(source, sink, { day: DAY });

    expect(sink.rows[0].dau).toBe(1);
    expect(sink.rows[0].mau).toBe(2);
    expect(sink.rows[0].stickiness).toBe(0.5);
  });

  it("한 조직이 실패해도 나머지는 계속 처리하고 실패를 보고한다", async () => {
    const source = fakeSource({
      orgIds: ["org-A", "org-bad", "org-B"],
      members: { "org-A": ["a1"], "org-B": ["b1"] },
      events: [],
      deals: {},
      failOn: "org-bad",
    });
    const sink = fakeSink();

    const res = await runDailyRollup(source, sink, { day: DAY });

    expect(res.rows.map((r) => r.orgId)).toEqual(["org-A", "org-B"]);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].orgId).toBe("org-bad");
    expect(res.failures[0].error).toContain("멤버 조회 실패");
  });

  it("실패한 조직은 0 행으로 채워 넣지 않는다(허위 데이터 금지)", async () => {
    const source = fakeSource({
      orgIds: ["org-bad"],
      members: {},
      events: [],
      deals: {},
      failOn: "org-bad",
    });
    const sink = fakeSink();
    await runDailyRollup(source, sink, { day: DAY });

    expect(sink.rows).toHaveLength(0);
  });

  it("재실행은 멱등이다(같은 day+org 는 덮어쓴다)", async () => {
    const source = fakeSource({
      orgIds: ["org-A"],
      members: { "org-A": ["a1"] },
      events: [{ orgId: "org-A", actorId: "a1", at: "2026-07-27T01:00:00.000Z" }],
      deals: {},
    });
    const sink = fakeSink();

    await runDailyRollup(source, sink, { day: DAY });
    await runDailyRollup(source, sink, { day: DAY });

    expect(sink.rows).toHaveLength(1);
  });

  it("day 미지정이면 asOf 기준 어제를 집계한다", async () => {
    const source = fakeSource({ orgIds: [], members: {}, events: [], deals: {} });
    const res = await runDailyRollup(source, fakeSink(), {
      asOf: new Date("2026-07-28T00:30:00.000Z"),
    });
    expect(res.day).toBe("2026-07-27");
  });

  it("잘못된 day 는 즉시 던진다(배치 설정 오류는 조용히 넘기지 않는다)", async () => {
    const source = fakeSource({ orgIds: [], members: {}, events: [], deals: {} });
    await expect(
      runDailyRollup(source, fakeSink(), { day: "2026/07/27" }),
    ).rejects.toThrow(/잘못된 집계 날짜/);
  });

  it("조직이 없으면 빈 결과(오류 아님)", async () => {
    const res = await runDailyRollup(
      fakeSource({ orgIds: [], members: {}, events: [], deals: {} }),
      fakeSink(),
      { day: DAY },
    );
    expect(res.rows).toHaveLength(0);
    expect(res.failures).toHaveLength(0);
  });
});
