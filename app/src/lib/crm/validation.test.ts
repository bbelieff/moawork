import { describe, it, expect } from "vitest";
import {
  ValidationError,
  parseCreateBoard,
  parseUpdateBoard,
  parseCreateItem,
  parseUpdateItem,
  parseMoveStage,
  parseViewConfig,
  parseCreateView,
  isColumnType,
} from "./validation";

describe("parseCreateBoard", () => {
  it("name 필수, description 선택", () => {
    expect(parseCreateBoard({ name: "신규고객" })).toEqual({
      name: "신규고객",
      description: undefined,
    });
  });
  it("name 없으면 에러", () => {
    expect(() => parseCreateBoard({})).toThrow(ValidationError);
    expect(() => parseCreateBoard({ name: "  " })).toThrow(ValidationError);
  });
  it("객체 아니면 에러", () => {
    expect(() => parseCreateBoard("x")).toThrow(ValidationError);
  });
});

describe("parseUpdateBoard", () => {
  it("부분 갱신 필드만", () => {
    expect(parseUpdateBoard({ archived: true })).toEqual({ archived: true });
  });
  it("변경 필드 없으면 에러", () => {
    expect(() => parseUpdateBoard({})).toThrow(ValidationError);
  });
  it("archived 타입 검사", () => {
    expect(() => parseUpdateBoard({ archived: "yes" })).toThrow(ValidationError);
  });
});

describe("parseCreateItem / parseUpdateItem", () => {
  it("생성: name 필수, values/ stageKey 선택", () => {
    expect(parseCreateItem({ name: "홍길동", stageKey: "consulting", values: { 금액: 100 } })).toEqual(
      { name: "홍길동", stageKey: "consulting", values: { 금액: 100 } },
    );
  });
  it("갱신: 최소 1필드", () => {
    expect(() => parseUpdateItem({})).toThrow(ValidationError);
    expect(parseUpdateItem({ name: "새이름" })).toEqual({ name: "새이름" });
  });
  it("values 는 객체여야 함", () => {
    expect(() => parseCreateItem({ name: "x", values: [] })).toThrow(ValidationError);
  });
});

describe("parseMoveStage", () => {
  it("stageKey 필수", () => {
    expect(parseMoveStage({ stageKey: "done" })).toEqual({ stageKey: "done" });
    expect(() => parseMoveStage({})).toThrow(ValidationError);
  });
});

describe("parseViewConfig / parseCreateView", () => {
  it("필터/정렬 파싱", () => {
    const cfg = parseViewConfig({
      filters: [{ columnKey: "금액", operator: "gt", value: 100 }],
      sorts: [{ columnKey: "금액", direction: "desc" }],
    });
    expect(cfg.filters).toHaveLength(1);
    expect(cfg.sorts[0]).toEqual({ columnKey: "금액", direction: "desc" });
  });
  it("잘못된 연산자/방향 거부", () => {
    expect(() => parseViewConfig({ filters: [{ columnKey: "a", operator: "??" }] })).toThrow(
      ValidationError,
    );
    expect(() => parseViewConfig({ sorts: [{ columnKey: "a", direction: "up" }] })).toThrow(
      ValidationError,
    );
  });
  it("빈 config 허용(전체 뷰)", () => {
    expect(parseViewConfig({})).toEqual({ filters: [], sorts: [] });
  });
  it("뷰 생성: name + config", () => {
    const v = parseCreateView({ name: "완료건", config: { filters: [], sorts: [] } });
    expect(v.name).toBe("완료건");
  });
});

describe("isColumnType", () => {
  it("유효 타입만 true", () => {
    expect(isColumnType("formula")).toBe(true);
    expect(isColumnType("banana")).toBe(false);
  });
});
