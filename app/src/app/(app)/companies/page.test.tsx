import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" }, org: { id: "org-1" } })),
  applyAs: vi.fn((ctx) => ctx),
}));
vi.mock("@/lib/companies/server", () => ({ loadCompaniesView: mocks.load }));

import CompaniesPage from "./page";

describe("CompaniesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue({ status: "ready", companies: [], dealsStatus: "ready" });
  });

  it("renders the request-scoped company read model", async () => {
    const html = renderToStaticMarkup(await CompaniesPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("등록된 회사가 없습니다");
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ org: { id: "org-1" } }));
  });

  it("shows a database failure instead of a fake empty state", async () => {
    mocks.load.mockResolvedValue({ status: "error" });
    const html = renderToStaticMarkup(await CompaniesPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("회사 정보를 불러오지 못했습니다");
    expect(html).not.toContain("등록된 회사가 없습니다");
  });
});
