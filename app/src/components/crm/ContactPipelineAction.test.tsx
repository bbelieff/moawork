import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm/contactPipelineActions", () => ({
  mutateContactPipeline: vi.fn(),
}));

import { companyRowsFromResponse, ContactPipelineAction } from "./ContactPipelineAction";

describe("ContactPipelineAction", () => {
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
});
