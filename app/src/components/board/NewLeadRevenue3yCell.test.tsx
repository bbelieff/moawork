import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./NewLeadRevenue3yCell.tsx", import.meta.url), "utf8");

describe("Issue #600 백만원 매출 leaf", () => {
  it("새 백만원 값만 제출하고 legacy 매출 구간은 읽기 fallback으로 보존한다", () => {
    expect(source).toContain("saveNewLeadRevenue3yAction");
    expect(source).toContain('name="revenue3yMillion"');
    expect(source).toContain("legacyRevenueBand");
    expect(source).toContain('"기존 구간: " + legacy');
    expect(source).not.toContain('name="revenue_band"');
  });

  it("숫자 입력과 백만원 단위, 오류를 접근 가능한 계약으로 노출한다", () => {
    expect(source).toContain('aria-label="3개년매출"');
    expect(source).toContain('inputMode="numeric"');
    expect(source).toContain("백만원");
    expect(source).toContain('role="alert"');
  });
});
