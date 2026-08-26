import { describe, expect, it } from "vitest";
import {
  EXISTING_LOAN_RECORDS_KEY,
  existingLoanRecordsFromValues,
  existingLoanRecordsSummary,
  existingLoanProfileFromValues,
  existingLoanSummary,
  parseExistingLoanRecords,
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

  it("여러 기대출을 stable id와 함께 왕복하고 기존 단일 값은 첫 레코드로 승계한다", () => {
    const raw = JSON.stringify([
      { id: "loan-a", provider: "기업은행", month: "2025-03", amount: 120000000, rate: 4.2, terms: "만기일시", notes: "" },
      { id: "loan-b", provider: "국민은행", month: "2024-11", amount: 30000000, rate: 5.1, terms: "원리금균등", notes: "담보" },
    ]);
    const records = existingLoanRecordsFromValues({ [EXISTING_LOAN_RECORDS_KEY]: raw });
    expect(records.map((record) => record.id)).toEqual(["loan-a", "loan-b"]);
    expect(existingLoanRecordsSummary(records)).toContain("2건");
    expect(existingLoanRecordsFromValues({ existing_loans: 50_000_000 })).toEqual([
      expect.objectContaining({ id: "legacy", amount: 50_000_000 }),
    ]);
  });

  it("중복 id·잘못된 월·20건 초과 목록은 원자 저장 전에 거부한다", () => {
    const row = { id: "same", provider: "", month: "", amount: null, rate: null, terms: "", notes: "" };
    expect(parseExistingLoanRecords(JSON.stringify([row, row])).ok).toBe(false);
    expect(parseExistingLoanRecords(JSON.stringify([{ ...row, id: "a", month: "2025-13" }])).ok).toBe(false);
    expect(parseExistingLoanRecords(JSON.stringify(Array.from({ length: 21 }, (_, index) => ({ ...row, id: `loan-${index}` })))).ok).toBe(false);
  });

  it("대출연월과 신용점수 범위를 엄격히 검증한다", () => {
    expect(parseLoanMonth("2025-13")).toEqual({ ok: false, message: "대출연월을 연도-월 형식으로 입력해 주세요." });
    expect(parseLoanMonth("2025-03")).toEqual({ ok: true, value: "2025-03" });
    expect(parseCreditScore("1001", "NCB").ok).toBe(false);
    expect(parseCreditScore("850.5", "KCB").ok).toBe(false);
    expect(parseCreditScore("850", "KCB")).toEqual({ ok: true, value: 850 });
  });
});
