import { describe, expect, it } from "vitest";
import {
  buildLedgerReport,
  describeLedgerReportFilter,
  EMPTY_LEDGER_REPORT_FILTER,
  filterLedgerReportRows,
  LEDGER_REPORT_UNASSIGNED,
  ledgerProductLabel,
  ledgerReportAssigneeOptions,
  ledgerReportCompanyOptions,
  toYearlyLedgerRows,
  type LedgerReportFilter,
  type LedgerReportGrouping,
  type LedgerReportRow,
} from "./report";

function row(
  partial: Partial<LedgerReportRow> & Pick<LedgerReportRow, "id" | "occurredOn" | "kind" | "amount">,
): LedgerReportRow {
  return {
    dealId: `deal-${partial.id}`,
    companyName: "가나상사",
    assigneeId: "user-1",
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

const filter = (patch: Partial<LedgerReportFilter> = {}): LedgerReportFilter => ({
  ...EMPTY_LEDGER_REPORT_FILTER,
  ...patch,
});

describe("ledgerProductLabel — 상품명칭(세부명칭)", () => {
  it.each([
    ["둘 다 있으면 괄호로 묶는다", "혁신성장자금", "일반운전자금", "혁신성장자금(일반운전자금)"],
    ["세부명칭이 없으면 상품명칭만", "혁신성장자금", null, "혁신성장자금"],
    ["공백만 든 세부명칭은 없는 것으로 본다", "혁신성장자금", "   ", "혁신성장자금"],
    // 보드 행이 통째로 없거나 RLS 가 셀을 가린 경우 — 오류가 아니라 빈 칸이다.
    ["둘 다 없으면 null(빈 칸)", null, null, null],
    // 시안에 없는 조합. 괄호만 남은 「(일반운전자금)」 을 만들지 않는다.
    ["상품명칭만 없으면 세부명칭 하나만", null, "일반운전자금", "일반운전자금"],
  ])("%s", (_name, fundName, productName, expected) => {
    expect(ledgerProductLabel({ fundName, productName })).toBe(expected);
  });
});

describe("filterLedgerReportRows — 네 축(기간·업체·담당자·수납구분)", () => {
  const rows = [
    row({ id: "a", occurredOn: "2026-01-10", kind: "contract_deposit", amount: 100, companyName: "가나상사", assigneeId: "u1", assigneeName: "담당A" }),
    row({ id: "b", occurredOn: "2026-03-05", kind: "fee", amount: 200, companyName: "다라기업", assigneeId: "u2", assigneeName: "담당B" }),
    row({ id: "c", occurredOn: "2026-06-30", kind: "fee", amount: 300, companyName: "가나상사", assigneeId: null, assigneeName: null }),
  ];

  it.each<[string, LedgerReportFilter, string[]]>([
    ["빈 필터는 전부 통과시킨다", filter(), ["a", "b", "c"]],
    ["from 은 발생일 포함 경계", filter({ from: "2026-03-05" }), ["b", "c"]],
    ["to 도 발생일 포함 경계", filter({ to: "2026-03-05" }), ["a", "b"]],
    ["기간은 양끝 다 걸린다", filter({ from: "2026-02-01", to: "2026-04-01" }), ["b"]],
    ["업체", filter({ company: "가나상사" }), ["a", "c"]],
    ["담당자", filter({ assignee: "u2" }), ["b"]],
    ["담당자 미지정만", filter({ assignee: LEDGER_REPORT_UNASSIGNED }), ["c"]],
    ["수납구분 — 계약금", filter({ kind: "contract_deposit" }), ["a"]],
    ["수납구분 — 수수료", filter({ kind: "fee" }), ["b", "c"]],
    ["여러 축은 AND 로 겹친다", filter({ company: "가나상사", kind: "fee" }), ["c"]],
    ["맞는 게 없으면 빈 배열", filter({ company: "없는회사" }), []],
  ])("%s", (_name, applied, expected) => {
    expect(filterLedgerReportRows(rows, applied).map((r) => r.id)).toEqual(expected);
  });
});

describe("buildLedgerReport — 묶기·소계·합계", () => {
  // 시안 §② 의 예시 수치를 그대로 옮겼다: 두 업체 · 네 건 · 미수금 300,000.
  const rows = [
    row({ id: "1", companyName: "가나상사", assigneeId: "u1", assigneeName: "담당A", occurredOn: "2026-03-05", kind: "contract_deposit", amount: 1_000_000, receivedAmount: 1_000_000 }),
    row({ id: "2", companyName: "가나상사", assigneeId: "u1", assigneeName: "담당A", occurredOn: "2026-05-20", kind: "fee", amount: 5_000_000, receivedAmount: 5_500_000 }),
    row({ id: "3", companyName: "다라기업", assigneeId: "u2", assigneeName: "담당B", occurredOn: "2026-06-02", kind: "contract_deposit", amount: 1_200_000, receivedAmount: 1_200_000 }),
    row({ id: "4", companyName: "다라기업", assigneeId: "u2", assigneeName: "담당B", occurredOn: "2026-06-28", kind: "fee", amount: 3_000_000, receivedAmount: 2_700_000, paidOn: null }),
  ];

  it.each<[LedgerReportGrouping, string[], number[]]>([
    ["company", ["가나상사", "다라기업"], [6_000_000, 4_200_000]],
    ["assignee", ["담당A", "담당B"], [6_000_000, 4_200_000]],
    ["month", ["2026년 3월", "2026년 5월", "2026년 6월"], [1_000_000, 5_000_000, 4_200_000]],
  ])("%s 로 묶으면 그룹 라벨과 소계가 함께 나온다", (grouping, labels, subtotals) => {
    const report = buildLedgerReport(rows, filter(), grouping);
    expect(report.groups.map((g) => g.label)).toEqual(labels);
    expect(report.groups.map((g) => g.subtotal.amount)).toEqual(subtotals);
  });

  it("합계는 묶기와 무관하게 같다 — 묶는 방식이 매출을 바꾸면 안 된다", () => {
    const totals = (["company", "assignee", "month"] as const).map(
      (grouping) => buildLedgerReport(rows, filter(), grouping).total,
    );
    for (const total of totals) {
      expect(total).toEqual({
        amount: 10_200_000,
        received: 10_400_000,
        outstanding: 300_000,
        rowCount: 4,
      });
    }
  });

  it("소계의 합은 합계와 일치한다(어느 그룹도 새지 않는다)", () => {
    for (const grouping of ["company", "assignee", "month"] as const) {
      const report = buildLedgerReport(rows, filter(), grouping);
      const summed = report.groups.reduce((acc, group) => acc + group.subtotal.amount, 0);
      expect(summed).toBe(report.total.amount);
      expect(report.groups.reduce((acc, g) => acc + g.subtotal.rowCount, 0)).toBe(report.total.rowCount);
    }
  });

  it("★ 미수금은 entry 단위 max(0, 공급가-입금액) — 초과입금이 다른 건의 미수금을 가리지 않는다", () => {
    // 순합계라면 (5.5M+2.7M) - (5M+3M) = 200,000 이 나와 진짜 미수금 300,000 이 줄어든다.
    const report = buildLedgerReport(rows, filter(), "company");
    expect(report.total.outstanding).toBe(300_000);
    expect(report.groups.map((g) => g.subtotal.outstanding)).toEqual([0, 300_000]);
  });

  it("그룹 안은 발생일 오름차순, 같은 날이면 id 로 확정한다", () => {
    const sameDay = [
      row({ id: "z", occurredOn: "2026-04-01", kind: "fee", amount: 1 }),
      row({ id: "a", occurredOn: "2026-04-01", kind: "fee", amount: 1 }),
      row({ id: "m", occurredOn: "2026-01-01", kind: "fee", amount: 1 }),
    ];
    const report = buildLedgerReport(sameDay, filter(), "company");
    expect(report.groups[0].rows.map((r) => r.id)).toEqual(["m", "a", "z"]);
  });

  it("필터가 먼저 걸리고 그 결과만 묶인다", () => {
    const report = buildLedgerReport(rows, filter({ kind: "fee" }), "company");
    expect(report.total).toMatchObject({ amount: 8_000_000, rowCount: 2 });
    expect(report.groups.map((g) => g.label)).toEqual(["가나상사", "다라기업"]);
  });

  it("맞는 항목이 없으면 그룹도 합계도 0 — 예전 값이 남지 않는다", () => {
    const report = buildLedgerReport(rows, filter({ company: "없는회사" }), "company");
    expect(report.groups).toEqual([]);
    expect(report.total).toEqual({ amount: 0, received: 0, outstanding: 0, rowCount: 0 });
    expect(report.totalLabel).toBe("합계 — 0개 업체 · 수납 0건");
  });

  it("합계 줄 문구는 묶은 단위를 그대로 센다", () => {
    expect(buildLedgerReport(rows, filter(), "company").totalLabel).toBe("합계 — 2개 업체 · 수납 4건");
    expect(buildLedgerReport(rows, filter(), "assignee").totalLabel).toBe("합계 — 2개 담당자 · 수납 4건");
    expect(buildLedgerReport(rows, filter(), "month").totalLabel).toBe("합계 — 3개 월 · 수납 4건");
  });

  it("담당자가 비어 있어도 한 그룹으로 모인다(빈 이름으로 흩어지지 않는다)", () => {
    const report = buildLedgerReport(
      [
        row({ id: "a", occurredOn: "2026-01-01", kind: "fee", amount: 10, assigneeId: null, assigneeName: null }),
        row({ id: "b", occurredOn: "2026-01-02", kind: "fee", amount: 20, assigneeId: null, assigneeName: null }),
      ],
      filter(),
      "assignee",
    );
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].label).toBe("미지정");
    expect(report.groups[0].subtotal.amount).toBe(30);
  });
});

describe("필터 선택지", () => {
  const rows = [
    row({ id: "a", occurredOn: "2026-01-01", kind: "fee", amount: 1, companyName: "하나상사", assigneeId: "u2", assigneeName: "홍길동" }),
    row({ id: "b", occurredOn: "2026-01-02", kind: "fee", amount: 1, companyName: "가나상사", assigneeId: "u1", assigneeName: "김철수" }),
    row({ id: "c", occurredOn: "2026-01-03", kind: "fee", amount: 1, companyName: "가나상사", assigneeId: null, assigneeName: null }),
  ];

  it("업체는 중복 없이 가나다순", () => {
    expect(ledgerReportCompanyOptions(rows)).toEqual([
      { value: "가나상사", label: "가나상사" },
      { value: "하나상사", label: "하나상사" },
    ]);
  });

  it("담당자는 id 로 갈리고 미지정도 고를 수 있다", () => {
    expect(ledgerReportAssigneeOptions(rows)).toEqual([
      { value: "u1", label: "김철수" },
      { value: LEDGER_REPORT_UNASSIGNED, label: "미지정" },
      { value: "u2", label: "홍길동" },
    ]);
  });
});

describe("describeLedgerReportFilter — 인쇄물에 남는 조건 한 줄", () => {
  it("아무것도 안 고르면 전부 «전체»", () => {
    expect(describeLedgerReportFilter(filter())).toBe("전체 기간 · 전체 업체 · 전체 담당자 · 전체 수납구분");
  });

  it("고른 값이 그대로 문장에 들어간다", () => {
    expect(
      describeLedgerReportFilter(
        filter({ from: "2026-01-01", to: "2026-06-30", company: "가나상사", assignee: "u1", kind: "fee" }),
        { assignee: "김철수" },
      ),
    ).toBe("2026-01-01 ~ 2026-06-30 · 가나상사 · 김철수 · 수수료");
  });

  it("한쪽만 고른 기간도 열린 채로 읽힌다", () => {
    expect(describeLedgerReportFilter(filter({ from: "2026-01-01" }))).toContain("2026-01-01 ~ 오늘");
    expect(describeLedgerReportFilter(filter({ to: "2026-06-30" }))).toContain("처음 ~ 2026-06-30");
  });
});

describe("toYearlyLedgerRows", () => {
  it("연도별 화면이 쓰는 좁은 행으로 줄인다 — 업체명이 자금건 제목 자리로 간다", () => {
    const [mapped] = toYearlyLedgerRows([
      row({ id: "a", occurredOn: "2026-01-01", kind: "fee", amount: 5, companyName: "가나상사" }),
    ]);
    expect(mapped).toEqual({
      id: "a",
      dealId: "deal-a",
      dealTitle: "가나상사",
      assigneeName: "담당A",
      kind: "fee",
      amount: 5,
      receivedAmount: 5,
      occurredOn: "2026-01-01",
      paidOn: "2026-01-01",
    });
  });
});
