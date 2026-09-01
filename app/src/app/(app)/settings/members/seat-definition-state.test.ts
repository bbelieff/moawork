import { describe, expect, it } from "vitest";
import { parseDutyLines, parseRuleLines, trimmedText, SEAT_DEFINITION_IDLE } from "./seat-definition-state";

/*
 * 역할 정의서에 «적은 것을 읽는» 쪽 (#683).
 *
 * ★ 이 파일이 재는 가장 중요한 것은 **「읽을 때와 쓸 때가 같은 상한을 통과하는가」** 다.
 *   둘이 어긋나면 한 번 잘못 보여준 것이 다음 저장에서 «사실» 이 되어 데이터가 영구히 사라진다.
 */

describe("#683 적은 줄을 할 일로 읽는다", () => {
  it("「매일:」 「매주:」 「매월:」 앞말을 주기로 읽는다", () => {
    expect(parseDutyLines("매일: 아침에 뷰부터\n매주: 금요일 정산\n매월: 마감 점검")).toEqual([
      { cycle: "daily", text: "아침에 뷰부터" },
      { cycle: "weekly", text: "금요일 정산" },
      { cycle: "monthly", text: "마감 점검" },
    ]);
  });

  it("앞말이 없으면 매일로 둔다 — 적은 것을 버리지 않는다", () => {
    expect(parseDutyLines("그냥 적은 줄")).toEqual([{ cycle: "daily", text: "그냥 적은 줄" }]);
  });

  it("빈 줄과 공백만 있는 줄은 버린다", () => {
    expect(parseDutyLines("\n  \n할 일\n\n")).toEqual([{ cycle: "daily", text: "할 일" }]);
  });

  it("전각 콜론도 같이 읽는다", () => {
    expect(parseDutyLines("매주： 회의")).toEqual([{ cycle: "weekly", text: "회의" }]);
  });

  it("글자가 아니면 빈 목록이다", () => {
    expect(parseDutyLines(null)).toEqual([]);
  });
});

describe("#683 재검수 P2-C — 쓸 때와 읽을 때가 «같은» 상한을 통과해야 한다", () => {
  /*
   * 실제로 있었던 결함 —
   *   ① 31번째 줄을 적으면 DB 에는 «전부» 저장됐다 (쓰기에 상한이 없었다)
   *   ② 화면에는 30줄만 보였다 (읽기에는 상한이 있었다)
   *   ③ 「고치기」를 누르면 폼 기본값이 «잘린 값» 이다
   *   ④ 그대로 저장하는 순간 나머지가 영구히 사라진다
   * 한 번 잘못 보여준 것이 다음 저장에서 사실이 되어 버린다.
   */
  it("★ 판단 기준도 쓸 때 잘린다 — 저장된 것과 보이는 것이 같아야 왕복해도 안 잃는다", () => {
    const many = Array.from({ length: 200 }, (_, index) => `줄 ${index}`).join("\n");
    expect(parseRuleLines(many)).toHaveLength(30);
  });

  it("★ 한 줄이 너무 길면 쓸 때 잘린다", () => {
    expect(parseRuleLines("가".repeat(5000))[0]).toHaveLength(300);
  });

  it("★ 할 일도 마찬가지다 — 원래부터 대칭이었고 그대로여야 한다", () => {
    const many = Array.from({ length: 200 }, (_, index) => `매일: 할일 ${index}`).join("\n");
    expect(parseDutyLines(many)).toHaveLength(50);
  });
});

describe("#683 한 칸짜리 글", () => {
  it("비면 null 이다 — «빈 문자열» 과 «안 적음» 을 서버가 갈라 보게 한다", () => {
    expect(trimmedText("   ", 400)).toBeNull();
    expect(trimmedText(null, 400)).toBeNull();
  });

  it("길면 자르고 앞뒤 공백은 턴다", () => {
    expect(trimmedText("  요약  ", 400)).toBe("요약");
    expect(trimmedText("가".repeat(500), 400)).toHaveLength(400);
  });
});

describe("#683 시작 상태", () => {
  it("처음에는 성공도 실패도 아니고 할 말도 없다", () => {
    expect(SEAT_DEFINITION_IDLE).toEqual({ ok: false, message: "" });
  });
});
