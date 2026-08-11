import type {
  NotificationRoutingPort,
  ResolveRecipientsInput,
} from "@/lib/notify/recipients";
import { reportingHopsOf, type ReportingContext } from "./reporting";

export type ReportingRouteSource = {
  assigneeId: string | null;
  teamMembers: readonly string[];
  reportingContext: ReportingContext;
};

export interface ReportingRouteLoader {
  load(orgId: string, targetIds: readonly string[]): Promise<ReadonlyMap<string, ReportingRouteSource>>;
}

/**
 * BBE-124의 포트를 구현하는 얇은 어댑터다. 알림 모듈은 수정하지 않고,
 * 조직 조회 구현이 orgId로 격리된 스냅샷을 공급하도록 강제한다.
 */
export class OrgReportingNotificationRoutingPort implements NotificationRoutingPort {
  constructor(
    private readonly orgId: string,
    private readonly loader: ReportingRouteLoader,
  ) {}

  async load(
    targetIds: readonly string[],
  ): Promise<ReadonlyMap<string, Omit<ResolveRecipientsInput, "actorId">>> {
    const uniqueIds = [...new Set(targetIds)];
    const sources = await this.loader.load(this.orgId, uniqueIds);
    const routes = new Map<string, Omit<ResolveRecipientsInput, "actorId">>();

    for (const targetId of uniqueIds) {
      const source = sources.get(targetId);
      if (!source) continue;
      routes.set(targetId, {
        assigneeId: source.assigneeId,
        teamMembers: [...source.teamMembers],
        assigneeHierarchy: source.assigneeId
          ? reportingHopsOf(source.assigneeId, source.reportingContext).map((hop) => ({
              ...hop,
              source: "hierarchy" as const,
            }))
          : [],
      });
    }

    return routes;
  }
}
