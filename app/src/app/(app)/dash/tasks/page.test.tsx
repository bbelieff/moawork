import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx, Deal, Pipeline } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listDeals: vi.fn(),
  listPipelines: vi.fn(),
}));

vi.mock("@/components/auth/FeatureGateServer", () => ({
  FeatureGateServer: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/crm", () => ({
  getCrmService: () => ({
    listDeals: mocks.listDeals,
    listPipelines: mocks.listPipelines,
  }),
}));

import DashboardTasksPage from "./page";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const DEAL_ID_1 = "10000000-0000-4000-8000-000000000001";
const DEAL_ID_2 = "10000000-0000-4000-8000-000000000002";
const ctx = {
  org: { id: "org-1" },
  user: { id: "user-1" },
  role: "admin",
  scope: "all",
} as Ctx;

function todayInKorea(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function deal(id: string): Deal {
  const today = todayInKorea();
  return {
    id,
    org_id: "org-1",
    company_id: null,
    pipeline_id: "pipeline-1",
    stage_id: null,
    assigned_to: "user-1",
    title: `업무 ${id}`,
    amount: null,
    status_note: null,
    fee_terms: null,
    applied_on: null,
    custom: { due_date: today },
    created_at: `${today}T00:00:00.000Z`,
    updated_at: `${today}T00:00:00.000Z`,
  };
}

describe("DashboardTasksPage retry identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(ctx);
    mocks.listDeals.mockResolvedValue([deal(DEAL_ID_1), deal(DEAL_ID_2)]);
    mocks.listPipelines.mockResolvedValue([{ id: "pipeline-1", org_id: "org-1", name: "기본" }] satisfies Pipeline[]);
  });

  it("consumes an unknown redirect and binds the exact request only to its production form", async () => {
    const html = renderToStaticMarkup(await DashboardTasksPage({
      searchParams: Promise.resolve({
        result: "retryable_unknown",
        retryDealId: DEAL_ID_1,
        retryKind: "complete",
        retryRequestId: REQUEST_ID,
      }),
    }));

    expect(html).toContain("같은 작업을 다시 누르면 중복 없이 결과를 확인해요");
    expect(html.match(new RegExp(REQUEST_ID, "g"))).toHaveLength(1);
    expect(html).toContain(`name="dealId" value="${DEAL_ID_2}"`);
  });

  it("does not carry retry identity after a successful terminal result", async () => {
    const html = renderToStaticMarkup(await DashboardTasksPage({
      searchParams: Promise.resolve({
        result: "completed",
        retryDealId: DEAL_ID_1,
        retryKind: "complete",
        retryRequestId: REQUEST_ID,
      }),
    }));

    expect(html).toContain("변경 내용을 저장했어요");
    expect(html).not.toContain(REQUEST_ID);
  });
});
