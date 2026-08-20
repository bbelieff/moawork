import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LedgerEntryModal } from "./LedgerEntryModal";

function render(depositAlreadyReceived: boolean, feeTerms: string | null = null) {
  return renderToStaticMarkup(
    <LedgerEntryModal
      dealId="deal-1"
      feeTerms={feeTerms}
      depositAlreadyReceived={depositAlreadyReceived}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
}

describe("BBE-240 · LedgerEntryModal — 구분 토글 초기 상태", () => {
  it("계약금을 이미 받았으면 계약금 버튼이 비활성화되고 수수료가 기본 선택이다", () => {
    const html = render(true);
    expect(html).toMatch(/계약금<\/button>/);
    // disabled 속성이 실제로 붙어야 한다 — 안 그러면 «누를 수 있는데 안내만 하는» 상태가 된다.
    const depositButtonIdx = html.indexOf(">계약금<");
    const beforeDeposit = html.slice(0, depositButtonIdx);
    const buttonStart = beforeDeposit.lastIndexOf("<button");
    expect(html.slice(buttonStart, depositButtonIdx)).toContain("disabled=\"\"");
    expect(html).toContain("계약금은 이미 받았어요");
  });

  it("계약금이 없으면 계약금 버튼을 그대로 고를 수 있고 안내문이 없다", () => {
    const html = render(false);
    const depositButtonIdx = html.indexOf(">계약금<");
    const beforeDeposit = html.slice(0, depositButtonIdx);
    const buttonStart = beforeDeposit.lastIndexOf("<button");
    // Tailwind 클래스 이름 자체에 "disabled:..." 유틸리티가 들어 있어 단순
    // toContain("disabled") 로는 오탐한다 — 실제 disabled="" 속성만 정확히 본다.
    expect(html.slice(buttonStart, depositButtonIdx)).not.toContain('disabled=""');
    expect(html).not.toContain("계약금은 이미 받았어요");
  });

  it("부가세 체크박스는 기본 꺼짐이라 힌트칩이 처음엔 안 보인다", () => {
    const html = render(false);
    expect(html).not.toContain("입금액에 채우기");
    expect(html).not.toContain("세금계산서 발행함");
  });

  it("계약조건(자유기재)이 있고 수수료가 기본 선택이면 참고 텍스트를 보여준다", () => {
    const html = render(true, "정액 500만원 · 집행일=잔금일");
    expect(html).toContain("계약조건(자유기재)");
    expect(html).toContain("정액 500만원 · 집행일=잔금일");
  });

  it("계약금이 기본 선택이면(계약조건이 있어도) 수수료 전용 참고 텍스트는 안 보인다", () => {
    const html = render(false, "정액 500만원 · 집행일=잔금일");
    expect(html).not.toContain("계약조건(자유기재)");
  });
});
