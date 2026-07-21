import { describe, it, expect } from "vitest";
import {
  ValidationError,
  parseCreateCompany,
  parseUpdateCompany,
  parseCreateDeal,
  parseUpdateDeal,
  parseMoveStage,
  parseCreateActivity,
} from "./validation";

describe("parseCreateCompany", () => {
  it("name 필수 + 선택 필드 정규화", () => {
    const c = parseCreateCompany({ name: "회사", revenue: "1000", founded_on: "2020-01-01" });
    expect(c.name).toBe("회사");
    expect(c.revenue).toBe(1000);
    expect(c.founded_on).toBe("2020-01-01");
    expect(c.phone).toBeNull();
  });
  it("name 없으면 에러", () => {
    expect(() => parseCreateCompany({})).toThrow(ValidationError);
  });
  it("잘못된 날짜/숫자 거부", () => {
    expect(() => parseCreateCompany({ name: "x", founded_on: "2020/01/01" })).toThrow(ValidationError);
    expect(() => parseCreateCompany({ name: "x", revenue: "abc" })).toThrow(ValidationError);
  });
});

describe("parseUpdateCompany", () => {
  it("부분 갱신, 최소 1필드", () => {
    expect(parseUpdateCompany({ region: "서울" })).toEqual({ region: "서울" });
    expect(() => parseUpdateCompany({})).toThrow(ValidationError);
  });
});

describe("parseCreateDeal / parseUpdateDeal", () => {
  it("title 필수 + custom 객체 허용", () => {
    const d = parseCreateDeal({ title: "딜", amount: 500, custom: { a: 1 } });
    expect(d.title).toBe("딜");
    expect(d.amount).toBe(500);
    expect(d.custom).toEqual({ a: 1 });
  });
  it("title 없으면 에러, custom 비객체 거부", () => {
    expect(() => parseCreateDeal({})).toThrow(ValidationError);
    expect(() => parseCreateDeal({ title: "x", custom: [] })).toThrow(ValidationError);
  });
  it("갱신 최소 1필드", () => {
    expect(() => parseUpdateDeal({})).toThrow(ValidationError);
    expect(parseUpdateDeal({ title: "새제목" })).toEqual({ title: "새제목" });
  });
});

describe("parseMoveStage", () => {
  it("stageId 또는 stage_id 허용", () => {
    expect(parseMoveStage({ stageId: "s1" })).toEqual({ stageId: "s1" });
    expect(parseMoveStage({ stage_id: "s2" })).toEqual({ stageId: "s2" });
    expect(() => parseMoveStage({})).toThrow(ValidationError);
  });
});

describe("parseCreateActivity", () => {
  it("허용 type 만", () => {
    expect(parseCreateActivity({ type: "memo", content: "메모" })).toEqual({
      type: "memo",
      content: "메모",
    });
    expect(() => parseCreateActivity({ type: "invalid" })).toThrow(ValidationError);
  });
});
