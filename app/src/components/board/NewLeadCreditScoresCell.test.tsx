import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./NewLeadCreditScoresCell.tsx", import.meta.url), "utf8");

describe("Issue #600 합성 신용점수 leaf", () => {
  it("한 form에서 NCB/KCB를 함께 제출하되 durable key 이름을 새 UI key로 바꾸지 않는다", () => {
    expect(source).toContain("saveNewLeadCreditScoresAction");
    expect(source).toContain('name="ncb"');
    expect(source).toContain('name="kcb"');
    expect(source).not.toContain('name="credit_scores"');
    expect(source.match(/<form/g)).toHaveLength(1);
  });

  it("두 기관 입력과 합성 셀에 접근 가능한 이름을 제공한다", () => {
    expect(source).toContain('aria-label="신용점수"');
    expect(source).toContain('aria-label="NCB 신용점수"');
    expect(source).toContain('aria-label="KCB 신용점수"');
    expect(source).toContain('role="alert"');
  });
});
