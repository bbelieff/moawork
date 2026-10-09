import { describe, expect, it } from "vitest";
import { dDayLabel, endOfWeekKst, groupByDue, groupByWeek } from "./date-groups";

// 기준일 2026-10-09 은 금요일이다. 이번 주 = ~10-11(일), 다음 주 = 10-12(월)~10-18(일).
const TODAY = "2026-10-09";

describe("주 경계(월요일 시작)", () => {
  it("일요일까지가 이번 주다 — 일요일 당일이면 그날이 끝이다", () => {
    expect(endOfWeekKst("2026-10-09")).toBe("2026-10-11");
    expect(endOfWeekKst("2026-10-12")).toBe("2026-10-18");
    expect(endOfWeekKst("2026-10-11")).toBe("2026-10-11");
    // 달·해를 넘어가도 맞다.
    expect(endOfWeekKst("2026-12-31")).toBe("2027-01-03");
  });
});

describe("D-day 배지", () => {
  it("남은 날은 D-n, 당일은 D-day, 지난 날은 D+n", () => {
    expect(dDayLabel("2026-10-12", TODAY)).toBe("D-3");
    expect(dDayLabel(TODAY, TODAY)).toBe("D-day");
    expect(dDayLabel("2026-10-07", TODAY)).toBe("D+2");
  });
});

describe("내 할 일 — 오늘 / 내일 / 이번 주 / 그 뒤", () => {
  const due = (dueOn: string) => ({ dueOn });
  it("지난 일은 오늘에, 빈 묶음은 빼고 순서대로 묶는다", () => {
    const groups = groupByDue(
      [due("2026-10-20"), due("2026-10-08"), due(TODAY), due("2026-10-10"), due("2026-10-11")],
      (task) => task.dueOn,
      TODAY,
    );
    expect(groups.map((g) => [g.label, g.items.map((t) => t.dueOn)])).toEqual([
      ["오늘", ["2026-10-08", TODAY]],
      ["내일", ["2026-10-10"]],
      ["이번 주", ["2026-10-11"]],
      ["그 뒤", ["2026-10-20"]],
    ]);
  });

  it("일요일이면 내일(월)은 «내일» 이고 «이번 주» 묶음은 없다", () => {
    const groups = groupByDue([due("2026-10-12"), due("2026-10-13")], (t) => t.dueOn, "2026-10-11");
    expect(groups.map((g) => g.label)).toEqual(["내일", "그 뒤"]);
  });
});

describe("재접촉 — 이번 주 / 다음 주 / 그 뒤 / 날짜 없음", () => {
  const entry = (id: string, date: string | null) => ({ id, date });
  it("날짜 순으로 주별 묶고, 날짜 없는 것은 맨 뒤 «날짜 없음» 에 둔다", () => {
    const groups = groupByWeek(
      [
        entry("later", "2026-10-25"),
        entry("none", null),
        entry("next", "2026-10-12"),
        entry("past", "2026-10-02"),
        entry("sun", "2026-10-11"),
        entry("next-sun", "2026-10-18"),
      ],
      (e) => e.date,
      TODAY,
    );
    expect(groups.map((g) => [g.label, g.items.map((e) => e.id)])).toEqual([
      ["이번 주", ["past", "sun"]],
      ["다음 주", ["next", "next-sun"]],
      ["그 뒤", ["later"]],
      ["날짜 없음", ["none"]],
    ]);
  });
});
