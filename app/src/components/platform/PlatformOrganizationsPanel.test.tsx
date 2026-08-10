import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { connectedWorkspaceCount, PlatformOrganizationsPanel } from "./PlatformOrganizationsPanel";
import { unavailablePlatformAggregate, type PlatformAggregateState } from "@/lib/platform/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const aggregate: PlatformAggregateState = {
  kind: "ready",
  updatedAt: "2026-08-03T00:00:00Z",
  values: [{ label: "연결된 워크스페이스", value: "3", description: "안전 집계" }],
  freshness: { kind: "fresh", computedAt: "2026-08-03T00:00:00Z", ageHours: 2, staleAfterHours: 36 },
  coverage: { requestedDays: 30, receivedRows: 30, usableRows: 30, droppedRows: 0, partial: false },
  allZero: false,
};

describe("PlatformOrganizationsPanel", () => {
  it("shows pending company requests and the existing atomic approval actions", () => {
    const html = renderToStaticMarkup(
      <PlatformOrganizationsPanel
        aggregate={aggregate}
        requests={[{
          requestId: "10000000-0000-4000-8000-000000000001",
          desiredName: "테스트 회사",
          desiredSlug: "test-company",
          createdAt: "2026-08-03T01:00:00Z",
        }]}
      />,
    );

    expect(html).toContain("승인 대기");
    expect(html).toContain("1건");
    expect(html).toContain("연결된 회사");
    expect(html).toContain(">3<");
    expect(html).toContain("테스트 회사");
    expect(html).toContain("/w/test-company");
    expect(html).toContain("승인하고 회사 열기");
    expect(html).toContain("승인하지 않기");
    expect(html).not.toContain("requester_user_id");
  });

  it("renders an actionable empty state without inventing a pending request", () => {
    const html = renderToStaticMarkup(<PlatformOrganizationsPanel aggregate={aggregate} requests={[]} />);
    expect(html).toContain("지금 승인할 요청이 없어요");
    expect(html).toContain("0건");
    expect(html).not.toContain("승인하고 회사 열기");
  });

  it("fails closed when the approval RPC boundary is unavailable", () => {
    const html = renderToStaticMarkup(
      <PlatformOrganizationsPanel aggregate={unavailablePlatformAggregate()} requests={null} />,
    );
    expect(html).toContain("승인 요청을 불러오지 못했어요");
    expect(html).toContain("확인 필요");
    expect(html).toContain("집계 확인 필요");
    expect(html).not.toContain("승인하고 회사 열기");
  });

  it("reads only the named aggregate metric", () => {
    expect(connectedWorkspaceCount(aggregate)).toBe("3");
    expect(connectedWorkspaceCount(unavailablePlatformAggregate())).toBeNull();
    expect(connectedWorkspaceCount({ ...aggregate, kind: "ready", updatedAt: null, values: [] })).toBeNull();
  });
});
