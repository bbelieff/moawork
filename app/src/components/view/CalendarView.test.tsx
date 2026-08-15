import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarView } from "./CalendarView";

interface Row {
  id: string;
  title: string;
  due: string | null;
}

const ROWS: Row[] = [
  { id: "r1", title: "우진산업 실사", due: "2026-08-14" },
  { id: "r2", title: "날짜 미정 건", due: null },
];

describe("CalendarView", () => {
  it("월요일 시작 요일 헤더 7개를 렌더한다", () => {
    const html = renderToStaticMarkup(
      <CalendarView<Row> rows={ROWS} dateOf={(r) => r.due} rowKey={(r) => r.id} renderItem={(r) => r.title} year={2026} month={8} />,
    );
    for (const d of ["월", "화", "수", "목", "금", "토", "일"]) expect(html).toContain(`>${d}<`);
  });

  it("날짜가 있는 항목이 렌더되고, 날짜 없는 항목은 «날짜 없음» 구획에 들어간다", () => {
    const html = renderToStaticMarkup(
      <CalendarView<Row> rows={ROWS} dateOf={(r) => r.due} rowKey={(r) => r.id} renderItem={(r) => r.title} year={2026} month={8} />,
    );
    expect(html).toContain("우진산업 실사");
    expect(html).toContain("날짜 없음");
    expect(html).toContain("날짜 미정 건");
  });

  it("다른 달의 날짜 문자열은 이번 달 그리드에 배치되지 않는다", () => {
    const rows: Row[] = [{ id: "r3", title: "9월 건", due: "2026-09-01" }];
    const html = renderToStaticMarkup(
      <CalendarView<Row> rows={rows} dateOf={(r) => r.due} rowKey={(r) => r.id} renderItem={(r) => r.title} year={2026} month={8} />,
    );
    expect(html).toContain("9월 건"); // 날짜 없음 구획으로 빠짐
    expect(html).toContain("날짜 없음");
  });
});
