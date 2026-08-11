import { describe, expect, it, vi } from "vitest";
import { routeNotificationFeed } from "@/lib/notify/recipients";
import {
  OrgReportingNotificationRoutingPort,
  type ReportingRouteLoader,
} from "./notification-routing";
import type { ReportingContext } from "./reporting";

const context: ReportingContext = {
  departments: [
    { id: "root", parentId: null, headUserId: "owner" },
    { id: "sales", parentId: "root", headUserId: "lead" },
    { id: "vacant", parentId: "sales", headUserId: null },
  ],
  primaryDeptOf: new Map([
    ["owner", "root"],
    ["lead", "sales"],
    ["agent", "vacant"],
  ]),
  exceptionOf: new Map(),
  ownerUserId: "owner",
};

describe("OrgReportingNotificationRoutingPort", () => {
  it("orgId로 조회를 격리하고 중복 target을 한 번만 요청한다", async () => {
    const load = vi.fn<ReportingRouteLoader["load"]>().mockResolvedValue(new Map());
    const port = new OrgReportingNotificationRoutingPort("org-a", { load });

    await port.load(["deal-1", "deal-1", "deal-2"]);

    expect(load).toHaveBeenCalledWith("org-a", ["deal-1", "deal-2"]);
  });

  it("공석 부서를 건너뛴 계통 거리와 경로를 BBE-124 포트에 전달한다", async () => {
    const loader: ReportingRouteLoader = {
      async load(orgId, targetIds) {
        expect(orgId).toBe("org-a");
        return new Map(targetIds.map((id) => [id, {
          assigneeId: "agent",
          teamMembers: ["agent", "lead", "owner"],
          reportingContext: context,
        }]));
      },
    };
    const routes = await new OrgReportingNotificationRoutingPort("org-a", loader).load(["deal-1"]);
    const hierarchy = routes.get("deal-1")?.assigneeHierarchy;

    expect(hierarchy).toEqual([
      { userId: "lead", source: "hierarchy", distance: 1, path: ["agent", "lead"] },
      { userId: "owner", source: "hierarchy", distance: 2, path: ["agent", "lead", "owner"] },
    ]);

    const feed = [{ id: "f1", actor: "other", target_id: "deal-1" }];
    expect(routeNotificationFeed(feed, "owner", routes)[0]?.recipient).toMatchObject({
      locked: true,
      distance: 2,
      path: ["agent", "lead", "owner"],
    });
  });

  it("담당자가 없으면 팀 전체 경로를 그대로 제공한다", async () => {
    const loader: ReportingRouteLoader = {
      async load() {
        return new Map([["deal-1", {
          assigneeId: null,
          teamMembers: ["u1", "u2"],
          reportingContext: context,
        }]]);
      },
    };
    const routes = await new OrgReportingNotificationRoutingPort("org-a", loader).load(["deal-1"]);

    expect(routes.get("deal-1")).toMatchObject({ assigneeId: null, teamMembers: ["u1", "u2"] });
    expect(routes.get("deal-1")?.assigneeHierarchy).toEqual([]);
  });
});
