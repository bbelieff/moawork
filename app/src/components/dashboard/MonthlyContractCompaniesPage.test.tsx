import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MonthlyContractCompanies } from "@/lib/perf/types";
import { MonthlyContractCompaniesPage } from "./MonthlyContractCompaniesPage";

const ready: MonthlyContractCompanies = {
  period: "2026-08", range: { start: "2026-07-31T15:00:00.000Z", end: "2026-08-31T15:00:00.000Z" }, available: true,
  top: { companyId: "c1", name: "서울상사", dealCount: 2, execSum: 10000000, feeSum: 300000, latestPaidAt: "2026-08-15" },
  entries: [{ companyId: "c1", name: "서울상사", dealCount: 2, execSum: 10000000, feeSum: 300000, latestPaidAt: "2026-08-15" }],
};

describe("MonthlyContractCompaniesPage", () => {
  it("월별 순위·합계·회사 drill-down과 담당 범위를 렌더한다", () => {
    const html = renderToStaticMarkup(<MonthlyContractCompaniesPage data={ready} scope="assigned" />);
    expect(html).toContain("이달의 계약회사");
    expect(html).toContain("내 담당 회사만 표시합니다");
    expect(html).toContain("/companies/c1");
    expect(html).toContain("/dash/top-companies?month=2026-07");
    expect(html).toContain("/dash/top-companies?month=2026-09");
    expect(html).toContain("서울상사");
  });

  it("빈 달에는 명시적 안내와 회계 원장 이동을 렌더한다", () => {
    const html = renderToStaticMarkup(<MonthlyContractCompaniesPage data={{ ...ready, available: false, top: null, entries: [] }} scope="all" />);
    expect(html).toContain("이 달에 수납된 계약이 없습니다");
    expect(html).toContain('href="/ledger"');
  });
});
