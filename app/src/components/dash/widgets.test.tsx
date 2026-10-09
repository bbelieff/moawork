import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContractStatusWidget,
  ConversionWidget,
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

// ── 2026-10-09 대시보드 시각 1차 ─────────────────────────────

/** 한 덩어리 HTML 에서 data 속성으로 묶인 조각만 잘라 본다. */
function chunk(html: string, attr: string, value: string): string {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start < 0) return "";
  const next = html.indexOf(`${attr}="`, start + attr.length + 2);
  return html.slice(start, next < 0 ? undefined : next);
}

describe("PipelineWidget — 막대가 한 번 자라난다", () => {
  it("건수·비율 글자는 그대로, 막대는 최종 폭을 갖고 60ms 씩 늦게 자란다(상한 300ms)", () => {
    const stages = Array.from({ length: 7 }, (_, index) => ({
      stageId: `s${index}`,
      name: `단계${index}`,
      kind: "marketing" as const,
      sortOrder: index,
      count: index,
      ratio: index / 21,
    }));
    const html = renderToStaticMarkup(<PipelineWidget data={{ total: 21, unassigned: 0, stages }} />);
    expect(html).toContain("2건 · 9.5%");
    const fills = html.match(/data-bar-fill=""[^>]*/g) ?? [];
    expect(fills).toHaveLength(7);
    expect(fills.every((fill) => fill.includes("mw-bar-grow"))).toBe(true);
    expect(fills.map((fill) => /animation-delay:(\d+)ms/.exec(fill)?.[1])).toEqual([
      "0", "60", "120", "180", "240", "300", "300",
    ]);
    expect(fills[3]).toMatch(/width:14\.28\d*%/);
  });
});

describe("ConversionWidget — 고리 게이지", () => {
  it("단계마다 고리 가운데에 %, 아래에 도달/전체", () => {
    const html = renderToStaticMarkup(
      <ConversionWidget
        rates={[
          { kind: "meeting", reached: 3, total: 12, rate: 0.25 },
          { kind: "contract", reached: 0, total: 12, rate: 0 },
        ]}
      />,
    );
    const meeting = chunk(html, "data-conversion", "meeting");
    expect(meeting).toContain("25.0%");
    expect(meeting).toContain("미팅 도달");
    expect(meeting).toContain("3 / 12건");
    expect(meeting).toContain('stroke-dasharray="25 100"');
    expect(meeting).toContain("mw-ring-sweep");
    // 0% 는 칠할 호가 없다 — 바탕 고리와 글자만.
    const contract = chunk(html, "data-conversion", "contract");
    expect(contract).toContain("0.0%");
    expect(contract).not.toContain("data-ring-arc");
    // 그림은 낭독기에서 숨기고 숫자는 글자로 둔다.
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("ContractStatusWidget — 도넛 + 범례", () => {
  const data = {
    available: true,
    fieldKey: "contract",
    total: 10,
    unset: 2,
    options: [
      { optionId: "o1", label: "계약서 요청", count: 5, ratio: 0.5 },
      { optionId: "o2", label: "계약 완료", count: 3, ratio: 0.3 },
      { optionId: "o3", label: "취소", count: 0, ratio: 0 },
    ],
  };
  const html = renderToStaticMarkup(<ContractStatusWidget data={data} />);

  it("범례에 이름·건수·% 가 있고 미입력도 % 와 함께 나온다(0건 상황은 뺀다)", () => {
    expect(chunk(html, "data-legend", "o1")).toContain("계약서 요청");
    expect(chunk(html, "data-legend", "o1")).toContain("5건 · 50.0%");
    expect(chunk(html, "data-legend", "o2")).toContain("3건 · 30.0%");
    expect(chunk(html, "data-legend", "unset")).toContain("미입력");
    expect(chunk(html, "data-legend", "unset")).toContain("2건 · 20.0%");
    expect(html).not.toContain("취소");
  });

  it("도넛 조각은 범례와 같은 순서로 이어 붙고, 가운데에 전체 건수", () => {
    expect(chunk(html, "data-donut-slice", "o1")).toContain('stroke-dasharray="50 50"');
    expect(chunk(html, "data-donut-slice", "o2")).toContain('stroke-dashoffset="-50"');
    expect(chunk(html, "data-donut-slice", "unset")).toContain('stroke-dashoffset="-80"');
    expect(chunk(html, "data-donut-slice", "unset")).toContain("var(--mw-chart-empty)");
    expect(html).toContain("전체 건");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});

describe("ReContactWidget — 주별 묶음", () => {
  const entries = [
    { dealId: "d1", title: "가상 업체 1", dPlus180: "2026-10-12", dPlus365: null },
    { dealId: "d2", title: "가상 업체 2", dPlus180: "2026-10-09", dPlus365: null },
    { dealId: "d3", title: "가상 업체 3", dPlus180: null, dPlus365: null },
    { dealId: "d4", title: "가상 업체 4", dPlus180: "2026-10-30", dPlus365: null },
    { dealId: "d5", title: "가상 업체 5", dPlus180: "2026-10-11", dPlus365: null },
  ];
  const html = renderToStaticMarkup(<ReContactWidget entries={entries} today="2026-10-09" />);

  it("이번 주 / 다음 주 / 그 뒤 / 날짜 없음 순으로 묶는다", () => {
    const order = ["this-week", "next-week", "later", "undated"].map((key) =>
      html.indexOf(`data-recontact-group="${key}"`),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(chunk(html, "data-recontact-group", "this-week")).toContain("가상 업체 2");
    expect(chunk(html, "data-recontact-group", "this-week")).toContain("가상 업체 5");
    expect(chunk(html, "data-recontact-group", "next-week")).toContain("가상 업체 1");
    expect(chunk(html, "data-recontact-group", "later")).toContain("가상 업체 4");
    expect(chunk(html, "data-recontact-group", "undated")).toContain("가상 업체 3");
  });

  it("머리 배지는 이번 주 곳 수, 줄마다 D-day 배지(날짜 없으면 배지 없음)", () => {
    expect(html).toContain("이번 주 2곳");
    expect(chunk(html, "data-recontact-group", "this-week")).toContain("D-day");
    expect(chunk(html, "data-recontact-group", "this-week")).toContain("D-2");
    expect(chunk(html, "data-recontact-group", "next-week")).toContain("D-3");
    expect(chunk(html, "data-recontact-group", "undated")).not.toContain("data-dday");
  });
});
