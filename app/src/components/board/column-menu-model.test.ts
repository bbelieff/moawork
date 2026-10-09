/**
 * #845 5단계 — 칸 메뉴의 짧은 말·숫자 판정(순수 함수).
 * 대표(2026-10-08): "설명이 너무 많아 메뉴는 간결하게" — 한 줄짜리 쉬운 말만.
 */
import { describe, expect, it } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { FIELD_TYPES } from "@/lib/types";
import {
  COLUMN_MENU_TEXT,
  calcConsumersOf,
  columnDeleteLines,
  columnEditLabel,
  columnFillCount,
  columnIsReadOnly,
  columnKindWord,
  columnMetaParts,
  columnSortOptions,
} from "./column-menu-model";

const col = (over: Partial<BoardColumn>): BoardColumn => ({
  id: "c", org_id: "o", board_id: "b", key: "k", label: "칸", type: "text", source: "in",
  rightPinned: false, options_jsonb: null, sort_order: 0, width: null, ...over,
});

describe("칸 종류 한 낱말", () => {
  it("날짜/목록/사람/글자/금액/숫자/계산/연결 — 체크·파일만 따로", () => {
    expect(columnKindWord({ type: "date", source: "in" })).toBe("날짜");
    expect(columnKindWord({ type: "datetime", source: "in" })).toBe("날짜");
    expect(columnKindWord({ type: "select", source: "in" })).toBe("목록");
    expect(columnKindWord({ type: "status", source: "act" })).toBe("목록");
    expect(columnKindWord({ type: "multiselect", source: "in" })).toBe("목록");
    expect(columnKindWord({ type: "person", source: "in" })).toBe("사람");
    expect(columnKindWord({ type: "text", source: "auto" })).toBe("글자");
    expect(columnKindWord({ type: "phone", source: "in" })).toBe("글자");
    expect(columnKindWord({ type: "money", source: "in" })).toBe("금액");
    expect(columnKindWord({ type: "number", source: "in" })).toBe("숫자");
    expect(columnKindWord({ type: "calc", source: "calc" })).toBe("계산");
    expect(columnKindWord({ type: "text", source: "calc" })).toBe("계산");
    expect(columnKindWord({ type: "money", source: "lk" })).toBe("연결");
    expect(columnKindWord({ type: "checkbox", source: "in" })).toBe("체크");
    expect(columnKindWord({ type: "file", source: "in" })).toBe("파일");
    for (const type of FIELD_TYPES) expect(columnKindWord({ type, source: "in" }).length, type).toBeLessThanOrEqual(2);
  });

  it("고칠 수 없음 = 계산 칸 · 읽기 전용 · 계산 출처", () => {
    expect(columnIsReadOnly(col({ type: "calc", source: "in" }))).toBe(true);
    expect(columnIsReadOnly(col({ source: "calc" }))).toBe(true);
    expect(columnIsReadOnly(col({ is_readonly: true }))).toBe(true);
    expect(columnIsReadOnly(col({ source: "lk" }))).toBe(false);
  });
});

describe("회색 한 줄 — 「날짜 · 18/24 채움」", () => {
  it("종류 + 채움, 계산 칸은 「계산 · 고칠 수 없음」, 읽기 전용은 끝에 「고칠 수 없음」", () => {
    expect(columnMetaParts(col({ type: "date" }), { filled: 18, total: 24 }).join(" · ")).toBe("날짜 · 18/24 채움");
    expect(columnMetaParts(col({ type: "select" }), { filled: 20, total: 24 }).join(" · ")).toBe("목록 · 20/24 채움");
    expect(columnMetaParts(col({ type: "calc", source: "calc", is_readonly: true }), { filled: 24, total: 24 }).join(" · "))
      .toBe("계산 · 고칠 수 없음");
    expect(columnMetaParts(col({ type: "text", is_readonly: true }), { filled: 1, total: 2 }).join(" · "))
      .toBe("글자 · 1/2 채움 · 고칠 수 없음");
    expect(columnMetaParts(col({ type: "money" }), null)).toEqual(["금액"]);
  });
});

describe("채움 수", () => {
  const rows: Pick<ItemWithValues, "values">[] = [{ values: { k: "가" } }, { values: { k: "" } }, { values: {} }, { values: { k: [] } }, { values: { k: 0 } }];
  it("빈 값(빈 글자·빈 목록·없음)은 세지 않고 0 은 센다", () => {
    expect(columnFillCount(col({}), rows)).toEqual({ filled: 2, total: 5 });
  });
  it("체크 칸은 체크한 것만 채운 것으로 센다", () => {
    expect(columnFillCount(col({ type: "checkbox" }), [{ values: { k: true } }, { values: { k: false } }])).toEqual({ filled: 1, total: 2 });
  });
});

describe("메뉴 항목은 짧은 한 줄", () => {
  it("칸 종류마다 쉬운 말 정렬(자주 쓰는 쪽이 위)", () => {
    const labels = (type: BoardColumn["type"]) => columnSortOptions({ type }).map((option) => [option.direction, option.label]);
    expect(labels("text")).toEqual([["asc", "가나다순"], ["desc", "가나다 역순"]]);
    expect(labels("select")).toEqual([["asc", "가나다순"], ["desc", "가나다 역순"]]);
    expect(labels("date")).toEqual([["asc", "가까운 날짜순"], ["desc", "먼 날짜순"]]);
    expect(labels("money")).toEqual([["desc", "큰 금액순"], ["asc", "작은 금액순"]]);
    expect(labels("person")).toEqual([["asc", "이름순"]]);
    expect(labels("file")).toEqual([]);
  });

  it("어떤 칸·어떤 항목도 전문 용어·둘째 줄·예시가 없다", () => {
    const all = [
      ...Object.values(COLUMN_MENU_TEXT),
      ...FIELD_TYPES.flatMap((type) => columnSortOptions({ type }).map((option) => option.label)),
      ...FIELD_TYPES.map((type) => columnEditLabel({ type })),
    ];
    // 「필터」 는 2026-10-09 대표 결정으로 쓰는 말이다(정렬 항목은 여전히 「가나다순」 처럼 쉬운 말).
    for (const label of all) {
      expect(label, label).not.toMatch(/정렬|오름차순|내림차순|그룹|컬럼|예:|\n/u);
      expect(label.length, label).toBeLessThanOrEqual(10);
    }
  });

  it("목록 칸은 「선택지 고치기」, 나머지는 「입력 방식 바꾸기」", () => {
    expect(columnEditLabel({ type: "select" })).toBe("선택지 고치기");
    expect(columnEditLabel({ type: "status" })).toBe("선택지 고치기");
    expect(columnEditLabel({ type: "date" })).toBe("입력 방식 바꾸기");
  });
});

describe("지우기 확인 창 — 결과는 여기서만", () => {
  const catalog = [
    col({ key: "expected_review_end", label: "예상 심사 종료", type: "date" }),
    col({ key: "review_dday", label: "ƒ심사 D-day", type: "calc", source: "calc", is_readonly: true }),
    col({ key: "fee_paid_on", label: "수수료_입금일", type: "date" }),
    col({ key: "d180", label: "ƒD+180", type: "calc", source: "calc", is_readonly: true }),
    col({ key: "funded_on", label: "조달일", type: "date" }),
  ];

  it("062 계산 함수와 같은 이름 규칙으로 이 칸을 쓰는 계산 칸을 찾는다", () => {
    expect(calcConsumersOf(catalog[0], catalog)).toEqual(["심사 D-day"]);
    expect(calcConsumersOf(catalog[2], catalog)).toEqual(["D+180"]);
    // 이 탭에 「재신청 안내일」 계산 칸이 없으면 조달일을 쓰는 곳은 «모름» 이다.
    expect(calcConsumersOf(catalog[4], catalog)).toEqual([]);
  });

  it("값 N건 · 되돌리기 · 멈추는 계산 — 칸에는 없는 «7일 보관» 은 약속하지 않는다", () => {
    expect(columnDeleteLines(7, [])).toEqual({ main: "값 7건이 함께 휴지통으로 가요 · 바로 「되돌리기」로 살릴 수 있어요", calc: null });
    expect(columnDeleteLines(0, []).main).toBe("휴지통으로 가요 · 바로 「되돌리기」로 살릴 수 있어요");
    expect(columnDeleteLines(3, ["심사 D-day"]).calc).toBe("「심사 D-day」 계산이 멈춰요");
    expect(JSON.stringify(columnDeleteLines(3, ["심사 D-day"]))).not.toContain("7일");
  });
});
