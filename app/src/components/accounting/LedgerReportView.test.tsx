import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LedgerReportView } from "./LedgerReportView";
import type { LedgerReportRow } from "@/lib/accounting/report";

function row(
  partial: Partial<LedgerReportRow> & Pick<LedgerReportRow, "id" | "occurredOn" | "kind" | "amount">,
): LedgerReportRow {
  return {
    dealId: `deal-${partial.id}`,
    companyName: "가나상사",
    assigneeId: "u1",
    assigneeName: "담당A",
    institution: "직접",
    fundName: "혁신성장자금",
    productName: "일반운전자금",
    receivedAmount: partial.amount,
    paidOn: partial.occurredOn,
    taxInvoiceIssued: false,
    ...partial,
  };
}

const render = (rows: readonly LedgerReportRow[]) =>
  renderToStaticMarkup(<LedgerReportView rows={rows} printedOn="2026-08-20" printedBy="카뮈" />);

describe("LedgerReportView", () => {
  it("시안 §② 의 11개 열 머리를 그대로 그린다(내부 ID 는 없다)", () => {
    const html = render([row({ id: "a", occurredOn: "2026-03-05", kind: "contract_deposit", amount: 1_000_000 })]);
    for (const header of [
      "업체", "담당자", "진행기관", "상품명칭(세부명칭)",
      "수납구분", "발생일", "입금일", "금액(공급가)", "입금액", "미수금", "계산서",
    ]) {
      expect(html).toContain(header);
    }
    // 육하원칙으로 바꾸면서 뺀 것들이 되돌아오면 빨개진다.
    expect(html).not.toContain("업무 ID");
    expect(html).not.toContain("원장 ID");
  });

  it("★ 수납구분과 «구분» 을 섞지 않는다 — 보드의 구분(자금/지원금/…)과 다른 축이다", () => {
    const html = render([row({ id: "a", occurredOn: "2026-03-05", kind: "fee", amount: 1 })]);
    expect(html).toContain("수납구분");
    // 「구분」 이 단독 낱말로 라벨에 서면 보드 컬럼과 같은 이름이 된다.
    expect(html).not.toMatch(/>구분</);
  });

  it("리포트 머리에 조건 줄과 출력 도장이 남는다 — 인쇄물만 봐도 무엇을 뽑았는지 안다", () => {
    const html = render([row({ id: "a", occurredOn: "2026-03-05", kind: "fee", amount: 1 })]);
    expect(html).toContain("업무 원장 — 업체별");
    expect(html).toContain("전체 기간 · 전체 업체 · 전체 담당자 · 전체 수납구분");
    expect(html).toContain("출력 2026-08-20 · 카뮈");
  });

  it("소계 줄과 합계 줄이 그룹마다·전체에 하나씩 붙는다", () => {
    const html = render([
      row({ id: "1", occurredOn: "2026-03-05", kind: "contract_deposit", amount: 1_000_000 }),
      row({ id: "2", occurredOn: "2026-05-20", kind: "fee", amount: 5_000_000, receivedAmount: 5_500_000 }),
      row({ id: "3", companyName: "다라기업", occurredOn: "2026-06-28", kind: "fee", amount: 3_000_000, receivedAmount: 2_700_000, paidOn: null }),
    ]);
    expect(html).toContain("소계 — 가나상사");
    expect(html).toContain("소계 — 다라기업");
    expect(html).toContain("합계 — 2개 업체 · 수납 3건");
    expect(html).toContain("9,000,000"); // 합계 금액(공급가)
    expect(html).toContain("300,000"); // 미수금 — 초과입금이 가리지 않았다
  });

  it("상품명칭·세부명칭이 없으면 오류가 아니라 대시다(보드 탭을 지운 회사)", () => {
    const html = render([
      row({ id: "a", occurredOn: "2026-03-05", kind: "fee", amount: 1, institution: null, fundName: null, productName: null }),
    ]);
    expect(html).toContain("<td>—</td>");
    expect(html).not.toContain("불러오지 못했");
    // 「데이터 없음」 같은 단정은 RLS 로 가려진 멤버에게 거짓말이 된다.
    expect(html).not.toContain("데이터 없음");
  });

  it("세부명칭만 없으면 상품명칭만, 둘 다 있으면 괄호로 묶는다", () => {
    expect(render([row({ id: "a", occurredOn: "2026-03-05", kind: "fee", amount: 1, productName: null })]))
      .toContain("<td>혁신성장자금</td>");
    expect(render([row({ id: "b", occurredOn: "2026-03-05", kind: "fee", amount: 1 })]))
      .toContain("혁신성장자금(일반운전자금)");
  });

  it("미입금은 빈 칸이 아니라 「미입금」, 계산서는 발행 여부를 가른다", () => {
    const html = render([
      row({ id: "a", occurredOn: "2026-06-28", kind: "fee", amount: 100, receivedAmount: 0, paidOn: null }),
      row({ id: "b", occurredOn: "2026-06-29", kind: "fee", amount: 100, taxInvoiceIssued: true }),
    ]);
    expect(html).toContain("미입금");
    expect(html).toContain("발행✓");
  });

  it("출구는 둘뿐 — CSV 와 인쇄. 엑셀 버튼은 없다(시안 §② 결정)", () => {
    const html = render([row({ id: "a", occurredOn: "2026-03-05", kind: "fee", amount: 1 })]);
    expect(html).toContain("🖨 인쇄 · PDF 저장");
    expect(html).toContain(">CSV<");
    expect(html).not.toContain("xlsx");
    expect(html).not.toContain("엑셀 파일");
  });

  it("빈 결과는 «거짓 빈 표» 가 아니라 안내문이다", () => {
    const html = render([]);
    expect(html).toContain("고른 조건에 맞는 수납 항목이 없어요");
    expect(html).not.toContain("합계 —");
  });

  it("필터바와 모드 탭은 인쇄에서 빠지도록 표식을 달고 나온다", () => {
    const html = render([row({ id: "a", occurredOn: "2026-03-05", kind: "fee", amount: 1 })]);
    expect(html).toContain('data-print="hide"');
  });
});
