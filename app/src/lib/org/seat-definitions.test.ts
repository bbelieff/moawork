import { describe, expect, it } from "vitest";
import {
  parseSeatDuties,
  parseSeatRules,
  seatDefinitionIsEmpty,
  toSeatDefinition,
} from "./seat-definitions";

/**
 * #683 — 역할 정의서를 화면이 «믿을 수 있는» 모양으로 줄인다.
 *
 * jsonb 는 무엇이든 담을 수 있다. 그대로 화면에 넘기면 사람이 적은 이상한 값이
 * 화면을 깨뜨리거나, 더 나쁘게는 «있는 척» 한다.
 */

describe("#683 할 일 읽기", () => {
  it("주기와 글을 갖춘 것만 남긴다", () => {
    expect(parseSeatDuties([
      { cycle: "daily", text: "아침에 뷰부터" },
      { cycle: "weekly", text: "주간 점검" },
    ])).toEqual([
      { cycle: "daily", text: "아침에 뷰부터" },
      { cycle: "weekly", text: "주간 점검" },
    ]);
  });

  it("★ 글이 비면 버린다 — 빈 줄이 「할 일」로 보이면 안 된다", () => {
    expect(parseSeatDuties([{ cycle: "daily", text: "   " }, { cycle: "daily" }])).toEqual([]);
  });

  it("모르는 주기는 «매일» 로 둔다 — 버리지 않는다. 글이 있으면 할 일이다", () => {
    expect(parseSeatDuties([{ cycle: "언젠가", text: "무언가" }])).toEqual([{ cycle: "daily", text: "무언가" }]);
  });

  it("배열이 아니면 빈 목록", () => {
    expect(parseSeatDuties(null)).toEqual([]);
    expect(parseSeatDuties("글자")).toEqual([]);
    expect(parseSeatDuties({ cycle: "daily", text: "객체" })).toEqual([]);
  });

  it("앞뒤 공백은 지운다", () => {
    expect(parseSeatDuties([{ cycle: "daily", text: "  전화  " }])).toEqual([{ cycle: "daily", text: "전화" }]);
  });
});

describe("#683 판단 기준 읽기", () => {
  it("세 갈래를 나눠 읽는다", () => {
    expect(parseSeatRules({ escalate: ["계약금 조정"], handle: ["재통화"], avoid: ["업체 지우기"] }))
      .toEqual({ escalate: ["계약금 조정"], handle: ["재통화"], avoid: ["업체 지우기"] });
  });

  it("빈 줄과 글자 아닌 것은 버린다", () => {
    expect(parseSeatRules({ escalate: ["", "  ", 3, null, "진짜"] }).escalate).toEqual(["진짜"]);
  });

  it("모양이 아니면 빈 목록 셋", () => {
    expect(parseSeatRules(null)).toEqual({ escalate: [], handle: [], avoid: [] });
    expect(parseSeatRules([1, 2])).toEqual({ escalate: [], handle: [], avoid: [] });
  });
});

describe("#683 «비었는가» 판정", () => {
  const base = {
    department_id: "d1",
    role: "team_lead" as const,
    summary: null,
    duties: [],
    rules: {},
    signals: null,
    handover: null,
    updated_at: null,
    updated_by: null,
  };

  it("★ 아무것도 안 쓰면 비었다 — 화면이 「아직 아무도 안 썼습니다」라고 말한다", () => {
    expect(seatDefinitionIsEmpty(toSeatDefinition(base))).toBe(true);
  });

  it("정의서 자체가 없어도 비었다", () => {
    expect(seatDefinitionIsEmpty(null)).toBe(true);
    expect(seatDefinitionIsEmpty(undefined)).toBe(true);
  });

  it("한 줄이라도 있으면 «있다»", () => {
    expect(seatDefinitionIsEmpty(toSeatDefinition({ ...base, summary: "3일 안에 첫 통화" }))).toBe(false);
    expect(seatDefinitionIsEmpty(toSeatDefinition({ ...base, duties: [{ cycle: "daily", text: "전화" }] }))).toBe(false);
    expect(seatDefinitionIsEmpty(toSeatDefinition({ ...base, rules: { avoid: ["지우기"] } }))).toBe(false);
    expect(seatDefinitionIsEmpty(toSeatDefinition({ ...base, handover: "인수인계" }))).toBe(false);
  });
});

describe("#683 누가 언제 고쳤나", () => {
  it("이름을 찾아 준다 — 「누가 썼나」가 보여야 신뢰가 생긴다", () => {
    const def = toSeatDefinition(
      { department_id: null, role: "member", summary: "s", duties: [], rules: {}, signals: null, handover: null, updated_at: "2026-08-28T00:00:00Z", updated_by: "u1" },
      (id) => (id === "u1" ? "이대표" : null),
    );
    expect(def.updatedByName).toBe("이대표");
    expect(def.updatedAt).toBe("2026-08-28T00:00:00Z");
  });

  it("★ 이름을 못 찾으면 «모른다» 로 둔다 — 아이디를 화면에 노출하지 않는다", () => {
    const def = toSeatDefinition(
      { department_id: null, role: "member", summary: "s", duties: [], rules: {}, signals: null, handover: null, updated_at: null, updated_by: "unknown-uuid" },
      () => null,
    );
    expect(def.updatedByName).toBeNull();
  });
});
