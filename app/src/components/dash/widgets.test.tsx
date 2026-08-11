import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContractStatusWidget,
  FollowUpListWidget,
  PipelineWidget,
  ReContactWidget,
  SettlementWidget,
  StatCard,
} from "./widgets";

describe("dashboard widget UX writing", () => {
  it("uses plain Korean for unavailable and empty states", () => {
    const pipeline = renderToStaticMarkup(
      <PipelineWidget data={{ total: 0, unassigned: 0, stages: [] }} />,
    );
    const contract = renderToStaticMarkup(
      <ContractStatusWidget
        data={{ available: false, fieldKey: null, total: 0, unset: 0, options: [] }}
      />,
    );
    const emptyContract = renderToStaticMarkup(
      <ContractStatusWidget
        data={{ available: true, fieldKey: "contract", total: 0, unset: 0, options: [] }}
      />,
    );
    const settlement = renderToStaticMarkup(
      <SettlementWidget
        data={{
          available: false,
          provisional: false,
          count: 0,
          downPaymentSum: 0,
          feeSum: 0,
          totalRevenueSum: 0,
        }}
      />,
    );
    const homeSettlement = renderToStaticMarkup(
      <SettlementWidget
        data={{
          available: false,
          provisional: false,
          count: 0,
          downPaymentSum: 0,
          feeSum: 0,
          totalRevenueSum: 0,
        }}
        emptyHint="이번 달 수납 내역이 아직 없어요. 수수료입금일이 이번 달인 업무가 생기면 여기에 보여요."
      />,
    );
    const recontact = renderToStaticMarkup(<ReContactWidget entries={[]} />);

    expect(pipeline).toContain(
      "파이프라인 단계가 아직 없어요. 단계를 만들면 여기에 보여요.",
    );
    expect(contract).toContain(
      "계약상황을 아직 사용할 수 없어요. 계약상황 항목이 준비되면 여기에 보여요.",
    );
    expect(contract).not.toContain("002");
    expect(contract).not.toContain("프리셋");
    expect(emptyContract).toContain(
      "계약상황을 입력한 업무가 아직 없어요. 업무에 계약상황을 입력하면 여기에 보여요.",
    );
    expect(settlement).toContain(
      "정산 정보가 아직 없어요. 실행액과 수수료율을 입력하면 여기에 보여요.",
    );
    expect(homeSettlement).toContain(
      "이번 달 수납 내역이 아직 없어요. 수수료입금일이 이번 달인 업무가 생기면 여기에 보여요.",
    );
    expect(recontact).toContain(
      "이번 달에 재접촉할 업무가 없어요. 재접촉 날짜가 다가오면 여기에 보여요.",
    );
  });

  it("describes provisional settlement without internal model terms", () => {
    const html = renderToStaticMarkup(
      <SettlementWidget
        data={{
          available: true,
          provisional: true,
          count: 1,
          downPaymentSum: 0,
          feeSum: 0,
          totalRevenueSum: 1000,
        }}
      />,
    );

    expect(html).toContain(
      "업무 금액으로 계산한 예상값이에요. 실행액과 수수료율을 입력하면 정확한 금액이 보여요.",
    );
    expect(html).not.toContain("딜");
    expect(html).not.toContain("정산 원천");
    expect(html).not.toContain("amount");
  });
});

// ── StatCard — 숫자를 누르면 목록으로 들어간다(BBE-18) ──────

describe("StatCard", () => {
  it("href 가 있으면 카드 전체가 링크(<a>)가 된다", () => {
    const html = renderToStaticMarkup(
      <StatCard label="전체 업무" value={12} href="/dash/all" />,
    );
    expect(html).toContain("<a ");
    expect(html).toContain('href="/dash/all"');
    expect(html).toContain("전체 업무");
    expect(html).toContain("12");
  });

  it("href 가 없으면 링크를 만들지 않는다(드릴다운 목록이 없는 값)", () => {
    const html = renderToStaticMarkup(<StatCard label="합계" value="1,000원" />);
    expect(html).not.toContain("<a ");
  });
});

// ── FollowUpListWidget — 오늘 할 일(BBE-18) ─────────────────

describe("FollowUpListWidget", () => {
  it("비어 있으면 안내 문구만 보여준다(에러 없음)", () => {
    const html = renderToStaticMarkup(
      <FollowUpListWidget entries={[]} emptyHint="오늘 재접촉·재신청 안내할 업무가 없어요." />,
    );
    expect(html).toContain("오늘 재접촉·재신청 안내할 업무가 없어요.");
  });

  it("재접촉과 재신청 안내를 구분해서 보여준다", () => {
    const html = renderToStaticMarkup(
      <FollowUpListWidget
        entries={[
          { dealId: "a", title: "㈜가나다", kind: "reContact", dueDate: "2026-07-24" },
          { dealId: "b", title: "라마바 상사", kind: "reapply", dueDate: "2026-07-24" },
        ]}
        emptyHint="없음"
      />,
    );
    expect(html).toContain("㈜가나다");
    expect(html).toContain("재접촉");
    expect(html).toContain("라마바 상사");
    expect(html).toContain("재신청 안내");
  });

  it("같은 딜이 재접촉·재신청 안내 둘 다 해당하면 두 항목으로 각각 뜬다", () => {
    const html = renderToStaticMarkup(
      <FollowUpListWidget
        entries={[
          { dealId: "a", title: "겹침 업체", kind: "reContact", dueDate: "2026-07-24" },
          { dealId: "a", title: "겹침 업체", kind: "reapply", dueDate: "2026-07-24" },
        ]}
        emptyHint="없음"
      />,
    );
    expect(html.match(/겹침 업체/g)).toHaveLength(2);
  });
});
