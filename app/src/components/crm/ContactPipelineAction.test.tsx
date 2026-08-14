import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm/contactPipelineActions", () => ({
  mutateContactPipeline: vi.fn(),
}));

import { companyRowsFromResponse, ContactPipelineAction } from "./ContactPipelineAction";
import { companyFoundedOn, companyRevenue } from "@/components/board/BoardWorkspace";

describe("ContactPipelineAction", () => {
  it("normalizes board year and revenue values for PostgreSQL types", () => {
    expect(companyFoundedOn("2020")).toBe("2020-01-01");
    expect(companyFoundedOn("2020년")).toBe("");
    expect(companyRevenue("1,250,000")).toBe("1250000");
    expect(companyRevenue("54억")).toBe("");
  });
  it("unwraps the shared API data envelope for the company picker", () => {
    expect(companyRowsFromResponse({ data: [{ id: "company-1" }] })).toEqual([{ id: "company-1" }]);
    expect(companyRowsFromResponse([])).toEqual([]);
  });
  it("신규리드에는 D68 단일 컨택 이동 액션만 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <ContactPipelineAction dealId="00000000-0000-4000-8000-000000000020" kind="lead_to_contact" requestId="00000000-0000-4000-8000-000000000030" />,
    );
    expect(html).toContain("컨택 이동");
    expect(html).not.toContain("컨택 처리");
    expect(html).toContain('name="requestId"');
  });

  it("컨택 단계에는 업무관리 이동 액션을 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <ContactPipelineAction dealId="00000000-0000-4000-8000-000000000020" kind="contact_to_work" requestId="00000000-0000-4000-8000-000000000030" />,
    );
    expect(html).toContain("업체 연결");
    expect(html).not.toContain("업무관리 이동");
    expect(html).toContain("justify-end");
    expect(html).toContain("min-h-11");
  });

  it("renders a fresh contact-board handoff with its company name", () => {
    const html = renderToStaticMarkup(
      <ContactPipelineAction dealId={null} kind="contact_to_work" requestId="00000000-0000-4000-8000-000000000030" initialCompanyName="모아 상사" initialValues={{ bizNo: "1234567890", ceoName: "김대표" }} />,
    );
    expect(html).toContain('name="dealId" value=""');
    expect(html).toContain('value="모아 상사"');
    expect(html).toContain("업체 연결");
    expect(html).toContain('name="bizNo" value="1234567890"');
    expect(html).toContain('name="ceoName" value="김대표"');
  });
});
