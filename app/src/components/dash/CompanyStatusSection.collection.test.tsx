import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TodayHomeState } from "@/lib/dash/today-server";
import { MonthlyCollection } from "./MonthlyCollection";

function ready(contractDeposits: number, fees: number): TodayHomeState {
  return {
    kind: "ready",
    snapshot: {
      version: 2,
      orgId: "org-fixture",
      viewer: { userId: "user-fixture", role: "owner", scope: "all" },
      asOf: "2026-08-21T00:00:00.000Z",
      timezone: "Asia/Seoul",
      period: { today: "2026-08-21", monthStart: "2026-08-01", monthEndExclusive: "2026-09-01" },
      status: "ready",
      kpis: {
        calls: 0,
        callbacks: 0,
        meetings: 0,
        contractsWaiting: 0,
        contractDeposits,
        fees,
      },
      tasks: [],
      notifications: [],
      onboarding: null,
      missingSources: [],
      unfilledColumns: [],
    },
  };
}

describe("BBE-230/234 canonical 이번달 수납 fixture", () => {
  it("read_today_dashboard의 계약금과 수수료만 합쳐 한 번 표시한다", () => {
    const html = renderToStaticMarkup(<MonthlyCollection today={ready(1_200_000, 340_000)} />);

    expect(html).toContain("1,540,000원");
    expect(html).toContain("계약금 1,200,000원 · 수수료 340,000원");
    expect(html).not.toContain("전체 정산");
    expect(html).not.toContain("총매출");
  });
});
