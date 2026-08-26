import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Issue #589 신규리드 금융 셀", () => {
  it("기대출 편집기는 반복 가능한 여섯 필드를 한 원자 저장 폼에 둔다", () => {
    const source = readFileSync(new URL("./NewLeadLoanCell.tsx", import.meta.url), "utf8");
    expect(source).toContain('name="loanRecords"');
    expect(source).toContain("records.map");
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("＋ 기대출 추가");
    expect(source).toContain("const closeEditor = () =>");
    expect(source).toContain("setRecords(existingLoanRecordsFromValues(values))");
    for (const key of ["provider", "month", "amount", "rate", "terms", "notes"]) {
      expect(source).toContain(`${key}:`);
    }
    expect(source).toContain("saveNewLeadLoanProfileAction");
    expect(source).toContain("bg-mw-card");
  });

  it("NCB/KCB 입력은 숫자 1~1000으로 제한하고 일반 입력 표면을 쓴다", () => {
    const source = readFileSync(new URL("./NewLeadCreditScoreCell.tsx", import.meta.url), "utf8");
    expect(source).toContain("min={1}");
    expect(source).toContain("max={1000}");
    expect(source).toContain("step={1}");
    expect(source).toContain("bg-mw-card");
    expect(source).toContain("lastSubmittedRef");
    expect(source).toContain("event.currentTarget.value === lastSubmittedRef.current");
  });

  it("회사 상세의 EAV 금융 필드는 canonical deal 전용 저장기로 잘못 보내지 않는다", () => {
    const source = readFileSync(new URL("./ItemDetailPanel.tsx", import.meta.url), "utf8");
    expect(source).toContain("CANONICAL_NEW_LEAD_DETAIL_KEYS.has(entry.key)");
    expect(source).toContain('fieldKey === "credit_score_ncb"');
    expect(source).toContain("existingLoanRecordsSummary(existingLoanRecordsFromValues(row.values))");
  });

  it("신규리드 표는 금융 전용 편집기를 연결하고 일반 선택 필드에 상태 배색을 쓰지 않는다", () => {
    const source = readFileSync(new URL("./GroupTable.tsx", import.meta.url), "utf8");
    expect(source).toContain("<NewLeadLoanCell");
    expect(source).toContain("<NewLeadCreditScoreCell");
    expect(source).toContain('column.key === EXISTING_LOAN_KEYS.amount');
    expect(source).toContain('column.key === CREDIT_SCORE_KEYS.ncb');
    expect(source).toContain('column.type === "status" ? (');
    expect(source).toContain(') : column.type === "select" ? (');
    expect(source).toContain("event.currentTarget.form?.requestSubmit()");
    expect(source).toContain("border-mw-line bg-mw-card");
    expect(source).not.toContain("border-transparent bg-transparent px-1.5");
  });
});
