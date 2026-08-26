import { describe, expect, it } from "vitest";
import {
  existingLoanProfileFromValues,
  existingLoanSummary,
  parseCreditScore,
  parseLoanMonth,
  parseOptionalNumber,
} from "./financial-profile";

describe("신규리드 금융 정보", () => {
  it("기존 기대출 금액과 새 구조화 값을 함께 읽는다", () => {
    const profile = existingLoanProfileFromValues({
      existing_loan_provider: "기업은행",
      existing_loan_month: "2025-03",
      existing_loans: 120000000,
      existing_loan_rate: 4.2,
      existing_loan_terms: "만기일시상환",
      existing_loan_notes: "담보 없음",
    });
    expect(profile.amount).toBe(120000000);
    expect(existingLoanSummary(profile)).toBe("기업은행 · 2025-03 · 120,000,000원 · 4.2%");
  });

  it("빈 값은 null로, 쉼표가 있는 숫자는 숫자로 정규화한다", () => {
    expect(parseOptionalNumber("", "금액")).toEqual({ ok: true, value: null });
    expect(parseOptionalNumber("120,000,000", "금액")).toEqual({ ok: true, value: 120000000 });
  });

  it("대출연월과 신용점수 범위를 엄격히 검증한다", () => {
    expect(parseLoanMonth("2025-13")).toEqual({ ok: false, message: "대출연월을 연도-월 형식으로 입력해 주세요." });
    expect(parseLoanMonth("2025-03")).toEqual({ ok: true, value: "2025-03" });
    expect(parseCreditScore("1001", "NCB").ok).toBe(false);
    expect(parseCreditScore("850.5", "KCB").ok).toBe(false);
    expect(parseCreditScore("850", "KCB")).toEqual({ ok: true, value: 850 });
  });
});
