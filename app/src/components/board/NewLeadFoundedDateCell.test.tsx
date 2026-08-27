import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./NewLeadFoundedDateCell.tsx", import.meta.url), "utf8");

describe("Issue #600 정밀도 보존 창업일 leaf", () => {
  it("월 또는 일을 직접 입력하고 exact 문자열을 서버 액션으로 보낸다", () => {
    expect(source).toContain("saveNewLeadFoundedDateAction");
    expect(source).toContain('name="foundedDate"');
    expect(source).toContain("YYYY-MM 또는 YYYY-MM-DD");
    expect(source).toContain("defaultValue={shown}");
  });

  it("읽기 표시는 leaf formatter를 쓰고 오류를 입력과 연결한다", () => {
    expect(source).toContain("formatFoundedDate(value)");
    expect(source).toContain('aria-label="창업연월"');
    expect(source).toContain("aria-describedby");
    expect(source).toContain('role="alert"');
  });
});
