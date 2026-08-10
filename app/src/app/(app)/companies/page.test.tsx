import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Company } from "@/lib/types";

const mocks = vi.hoisted(() => ({ listCompanies: vi.fn(), listDeals: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" }, org: { id: "org-1" } })),
  applyAs: vi.fn((ctx) => ctx),
}));
vi.mock("@/lib/crm", () => ({
  getCrmService: () => ({ listCompanies: mocks.listCompanies, listDeals: mocks.listDeals }),
}));

import CompaniesPage from "./page";

const company = {
  id: "company-1",
  org_id: "org-1",
  name: "모아상사",
  biz_type: "컨설팅",
  region: "서울",
  owner_name: "김대표",
  phone: "02-000-0000",
  email: "private@example.com",
  revenue: null,
  founded_on: null,
  homepage: null,
  assigned_to: "user-1",
  created_at: "2026-01-01T00:00:00.000Z",
} satisfies Company;

describe("CompaniesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCompanies.mockResolvedValue([company]);
    mocks.listDeals.mockResolvedValue([{ company_id: company.id }]);
  });

  it("scoped 목록의 상세 링크와 건수를 표시하고 연락처 PII는 노출하지 않는다", async () => {
    const element = await CompaniesPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('href="/companies/company-1"');
    expect(html).toContain("모아상사 고객사 상세 보기");
    expect(html).toContain("진행 건");
    expect(html).not.toContain(company.phone);
    expect(html).not.toContain(company.email);
  });
});
