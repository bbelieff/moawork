import { describe, expect, it } from "vitest";
import {
  formatRevenueInput,
  formatRevenueMillion,
  parseRevenueMillion,
  readRevenueYears,
  REVENUE_YEAR_FIELDS,
  revenueYearsSummary,
  sortableRevenueYears,
} from "./revenue-years";

/**
 * #673 — 「3개년 매출은 백만원 단위는 맞는데 '매출'로 이름 바꾸고 칸을 4개 만들어줘
 *        Y-현재, Y-1,Y-2,Y-3 필드 넣고 천단위로 콤마, 백만원 될 수 있게」
 */

describe("#673 네 해", () => {
  it("Y-현재부터 Y-3까지 넷이고, 최신이 먼저다", () => {
    expect(REVENUE_YEAR_FIELDS.map((f) => f.label)).toEqual(["Y-현재", "Y-1", "Y-2", "Y-3"]);
    expect(REVENUE_YEAR_FIELDS.map((f) => f.key)).toEqual([
      "revenue_y0",
      "revenue_y1",
      "revenue_y2",
      "revenue_y3",
    ]);
  });
});

describe("#673 적은 것을 숫자로 읽는다", () => {
  it("★ 콤마를 지우고 읽는다 — 적는 사람이 콤마를 넣는다", () => {
    expect(parseRevenueMillion("1,250")).toBe(1250);
    expect(parseRevenueMillion("3,500,000")).toBe(3500000);
  });

  it("콤마 없이 적어도 읽는다", () => {
    expect(parseRevenueMillion("1250")).toBe(1250);
    expect(parseRevenueMillion(1250)).toBe(1250);
  });

  it("★ 0 은 «값» 이다 — 매출이 0 인 해가 있을 수 있다", () => {
    expect(parseRevenueMillion("0")).toBe(0);
    expect(parseRevenueMillion(0)).toBe(0);
  });

  it("빈 값은 값이 아니다", () => {
    expect(parseRevenueMillion("")).toBeNull();
    expect(parseRevenueMillion("   ")).toBeNull();
    expect(parseRevenueMillion(null)).toBeNull();
    expect(parseRevenueMillion(undefined)).toBeNull();
  });

  it("★ 음수·소수·글자는 안 받는다 — 백만원 «단위의 정수» 다", () => {
    expect(parseRevenueMillion("-100")).toBeNull();
    expect(parseRevenueMillion(-100)).toBeNull();
    expect(parseRevenueMillion("12.5")).toBeNull();
    expect(parseRevenueMillion("1억")).toBeNull();
    expect(parseRevenueMillion("약 1,000")).toBeNull();
  });

  it("숫자로 안 끝나는 콤마 조합도 막는다", () => {
    expect(parseRevenueMillion(",100")).toBeNull();
    expect(parseRevenueMillion("100,")).toBeNull();
  });
});

describe("#673 천단위 콤마로 보인다", () => {
  it("네 자리부터 콤마가 붙는다", () => {
    expect(formatRevenueMillion(1250)).toBe("1,250");
    expect(formatRevenueMillion(3500000)).toBe("3,500,000");
    expect(formatRevenueMillion(999)).toBe("999");
  });

  it("★ 값이 없으면 빈 칸이다 — 「0」 을 대신 보여 주지 않는다", () => {
    expect(formatRevenueMillion(null)).toBe("");
    expect(formatRevenueMillion(0)).toBe("0");
  });

  it("적는 도중에도 콤마가 따라온다", () => {
    expect(formatRevenueInput("1250")).toBe("1,250");
    expect(formatRevenueInput("1,250")).toBe("1,250");
  });

  it("★ 못 읽는 글자는 «버리지 않는다» — 적던 것이 사라지면 놀란다", () => {
    expect(formatRevenueInput("1억")).toBe("1억");
    expect(formatRevenueInput("")).toBe("");
  });
});

describe("#673 네 값을 하나로 묶어 본다", () => {
  const values = {
    revenue_y0: "1,250",
    revenue_y1: "980",
    revenue_y2: "",
    revenue_y3: "1,400",
    revenue_3y_million: "3500000",
  };

  it("아이템 값에서 네 해를 읽는다", () => {
    expect(readRevenueYears(values)).toEqual({
      revenue_y0: 1250,
      revenue_y1: 980,
      revenue_y2: null,
      revenue_y3: 1400,
    });
  });

  it("표 한 칸에 적힌 값만 줄여 보인다", () => {
    expect(revenueYearsSummary(readRevenueYears(values))).toBe(
      "Y-현재 1,250 · Y-1 980 · Y-3 1,400",
    );
  });

  it("하나도 없으면 빈 문자열 — 「—」 를 여기서 정하지 않는다", () => {
    expect(revenueYearsSummary(readRevenueYears({}))).toBe("");
  });
});

describe("#673 정렬", () => {
  it("★ 합계가 아니라 «가장 최근에 값이 있는 해» 로 견준다", () => {
    // 합계로 견주면 세 해를 적은 쪽이 무조건 커 보인다 — 그건 성실도 정렬이다.
    expect(sortableRevenueYears(readRevenueYears({ revenue_y0: "100", revenue_y1: "900" }))).toBe(100);
    expect(sortableRevenueYears(readRevenueYears({ revenue_y1: "900" }))).toBe(900);
  });

  it("값이 하나도 없으면 null", () => {
    expect(sortableRevenueYears(readRevenueYears({}))).toBeNull();
  });
});
