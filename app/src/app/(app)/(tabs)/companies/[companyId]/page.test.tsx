import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Company } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  getCompany: vi.fn(),
  listDeals: vi.fn(),
  listPipelines: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" }, org: { id: "org-1" } })),
  applyAs: vi.fn((ctx) => ctx),
}));
vi.mock("@/lib/crm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crm")>();
  return {
    ...actual,
    getCrmService: () => ({
      getCompany: mocks.getCompany,
      listDeals: mocks.listDeals,
      listPipelines: mocks.listPipelines,
    }),
  };
});

import CompanyDetailPage from "./page";
import { NotFoundError } from "@/lib/crm";

const company = {
  id: "company-1",
  org_id: "org-1",
  name: "모아상사",
  biz_type: null,
  region: null,
  owner_name: null,
  phone: null,
  email: null,
  revenue: null,
  founded_on: null,
  homepage: null,
  assigned_to: "user-1",
  created_at: "2026-01-01T00:00:00.000Z",
} satisfies Company;

describe("CompanyDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCompany.mockResolvedValue(company);
    mocks.listDeals.mockResolvedValue([]);
    mocks.listPipelines.mockResolvedValue([]);
  });

  it("고객사 가시성을 확인한 뒤 관련 데이터를 조회한다", async () => {
    const element = await CompanyDetailPage({
      params: Promise.resolve({ companyId: company.id }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("모아상사");
    expect(mocks.getCompany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listDeals.mock.invocationCallOrder[0],
    );
    expect(mocks.listDeals).toHaveBeenCalledWith(expect.anything(), { companyId: company.id });
  });

  it("unknown failure 뒤에는 같은 caller requestId를 유지하고 새 intent에는 재사용하지 않는다", async () => {
    const requestId = "90000000-0000-4000-8000-000000000123";
    const failed = await CompanyDetailPage({
      params: Promise.resolve({ companyId: company.id }),
      searchParams: Promise.resolve({ workStart: "failed", requestId }),
    });
    expect(renderToStaticMarkup(failed)).toContain(`name="requestId" value="${requestId}"`);

    const fresh = await CompanyDetailPage({
      params: Promise.resolve({ companyId: company.id }),
      searchParams: Promise.resolve({ workStart: "ok", requestId }),
    });
    expect(renderToStaticMarkup(fresh)).not.toContain(`name="requestId" value="${requestId}"`);
  });

  it("보이지 않는 고객사는 404로 수렴하고 후속 조회를 하지 않는다", async () => {
    mocks.getCompany.mockRejectedValue(new NotFoundError());

    await expect(
      CompanyDetailPage({
        params: Promise.resolve({ companyId: "foreign-company" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.listDeals).not.toHaveBeenCalled();
    expect(mocks.listPipelines).not.toHaveBeenCalled();
  });

  it("예상하지 못한 저장소 오류는 404로 숨기지 않는다", async () => {
    mocks.getCompany.mockRejectedValue(new Error("backend unavailable"));

    await expect(
      CompanyDetailPage({
        params: Promise.resolve({ companyId: company.id }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("backend unavailable");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
