import { describe, expect, it } from "vitest";
import {
  seatDefinitionDate,
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

describe("#683 검수 후속 — 화면이 감당할 수 있는 만큼만 넘긴다", () => {
  it("★ 할 일이 아무리 많아도 상한에서 끊는다 — 거대한 배열을 화면이 그대로 다 그리지 않게", () => {
    const huge = Array.from({ length: 500 }, (_, index) => ({ cycle: "daily", text: `할일 ${index}` }));
    expect(parseSeatDuties(huge)).toHaveLength(50);
  });

  it("★ 한 줄이 너무 길면 자른다", () => {
    const long = "가".repeat(5000);
    expect(parseSeatDuties([{ cycle: "daily", text: long }])[0].text).toHaveLength(300);
    expect(parseSeatRules({ escalate: [long] }).escalate[0]).toHaveLength(300);
  });

  it("★ 판단 기준도 갈래마다 상한이 있다", () => {
    const many = Array.from({ length: 200 }, (_, index) => `줄 ${index}`);
    const rules = parseSeatRules({ escalate: many, handle: many, avoid: many });
    expect([rules.escalate.length, rules.handle.length, rules.avoid.length]).toEqual([30, 30, 30]);
  });
});

describe("#683 날짜 — 하이드레이션도 안전하고 값도 맞아야 한다", () => {
  /*
   * 두 번 틀렸던 자리다.
   *   ① 맨 toLocaleDateString  → 서버(UTC)와 브라우저(로컬)가 다른 날짜를 그려 하이드레이션 불일치
   *   ② UTC 로 못 박음         → 한국 00:00~09:00 저장분이 매일 «어제» 로 보임 (9시간 창)
   * timeZone 을 명시하면 둘 다 풀린다. 하나를 포기할 필요가 없었다.
   */
  it("★ 런타임이 timeZone 을 실제로 지킨다 — 안 지키면 이 수정이 «조용히» 안 먹는다", () => {
    /*
     * Node 를 축소 ICU(small-icu)로 빌드하면 `timeZone` 옵션이 무시된다.
     * 그러면 아래 날짜 시험들은 «실행 환경의 기본 시간대가 한국이라» 통과해 버린다 —
     * 통과하는데 고쳐진 게 아닌 상태다. Seoul 과 UTC 를 견주면 그 경우 두 값이 같아져 FAIL 한다.
     *
     * ★ 다만 이 시험이 재는 것은 **시험을 돌리는 런타임 하나**다.
     *   배포 서버(Vercel)와 사용자 브라우저는 다른 프로세스라 거기가 축소 ICU 여도 여기는 초록이다.
     *   즉 이 시험은 «회귀를 막는» 것이지 «배포 환경을 증명하는» 것이 아니다.
     *   그걸 증명하려면 배포 런타임에서 직접 재야 한다 — 안 한 것을 한 척하지 않는다.
     */
    const at = new Date("2026-08-31T23:00:00Z");
    expect(
      at.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }),
      "런타임이 timeZone 을 무시한다 — full-icu 가 아닌 환경이다",
    ).not.toBe(at.toLocaleDateString("ko-KR", { timeZone: "UTC" }));
  });

  it("★ 한국 이른 아침에 저장한 것이 «어제» 로 보이지 않는다", () => {
    expect(seatDefinitionDate("2026-08-31T23:00:00Z")).toBe("2026. 9. 1."); // 한국 9/1 08:00
    expect(seatDefinitionDate("2026-08-31T15:30:00Z")).toBe("2026. 9. 1."); // 한국 9/1 00:30
    expect(seatDefinitionDate("2026-09-01T00:01:00Z")).toBe("2026. 9. 1."); // 한국 9/1 09:01
  });

  it("★ 한국 자정 직전은 그날로 남는다 — 반대편으로 밀리지 않았는지", () => {
    expect(seatDefinitionDate("2026-08-31T14:59:00Z")).toBe("2026. 8. 31."); // 한국 8/31 23:59
  });

  it("못 읽는 값은 빈 글자다 — 「Invalid Date」를 화면에 뿌리지 않는다", () => {
    expect(seatDefinitionDate(null)).toBe("");
    expect(seatDefinitionDate("")).toBe("");
    expect(seatDefinitionDate("어제")).toBe("");
  });
});
