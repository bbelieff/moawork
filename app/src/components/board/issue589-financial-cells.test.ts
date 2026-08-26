import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Issue #589 신규리드 금융 셀", () => {
  it("기대출 편집기는 여섯 필드를 한 저장 폼에 둔다", () => {
    const source = readFileSync(new URL("./NewLeadLoanCell.tsx", import.meta.url), "utf8");
    for (const name of ["loanProvider", "loanMonth", "loanAmount", "loanRate", "loanTerms", "loanNotes"]) {
      expect(source).toContain(`name="${name}"`);
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
  });

  it("회사 상세의 EAV 금융 필드는 canonical deal 전용 저장기로 잘못 보내지 않는다", () => {
    const source = readFileSync(new URL("./ItemDetailPanel.tsx", import.meta.url), "utf8");
    expect(source).toContain("CANONICAL_NEW_LEAD_DETAIL_KEYS.has(entry.key)");
    expect(source).toContain('fieldKey === "credit_score_ncb"');
    expect(source).toContain('fieldKey === "existing_loan_rate" ? 100');
  });
});
