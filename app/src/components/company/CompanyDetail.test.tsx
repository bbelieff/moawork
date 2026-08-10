import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanyDetail } from "./CompanyDetail";
import type { Company, Deal } from "@/lib/types";

const company: Company = {
  id: "company-1",
  org_id: "org-1",
  name: "모아상사",
  biz_type: "경영 컨설팅",
  region: "서울",
  owner_name: "김대표",
  phone: "02-000-0000",
  email: "owner@example.com",
  revenue: 120000000,
  founded_on: "2020-01-02",
  homepage: "https://example.com/company",
  assigned_to: "user-1",
  created_at: "2026-01-01T00:00:00.000Z",
};

const deal: Deal = {
  id: "deal-1",
  org_id: "org-1",
  company_id: company.id,
  pipeline_id: "pipeline-1",
  stage_id: "stage-1",
  assigned_to: "user-1",
  title: "정책자금 상담",
  amount: 30000000,
  status_note: null,
  applied_on: null,
  custom: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("CompanyDetail", () => {
  it("고객사 기본 정보와 관련 업무 링크를 표시한다", () => {
    const html = renderToStaticMarkup(
      <CompanyDetail company={company} deals={[deal]} stageNames={new Map([["stage-1", "상담 중"]])} />,
    );

    expect(html).toContain("모아상사");
    expect(html).toContain("고객 정보");
    expect(html).toContain("정책자금 상담");
    expect(html).toContain("상담 중");
    expect(html).toContain('/deals/deal-1');
    expect(html).toContain('href="https://example.com/company"');
  });

  it("관련 업무가 없으면 명시적인 빈 상태를 표시한다", () => {
    const html = renderToStaticMarkup(
      <CompanyDetail company={{ ...company, homepage: "javascript:alert(1)" }} deals={[]} stageNames={new Map()} />,
    );

    expect(html).toContain("연결된 업무가 없습니다");
    expect(html).toContain("확인할 수 없는 주소");
    expect(html).not.toContain("javascript:alert(1)");
  });
});
