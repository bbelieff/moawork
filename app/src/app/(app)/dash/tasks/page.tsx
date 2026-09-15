import Link from "next/link";
import { FeatureGateServer } from "@/components/auth/FeatureGateServer";
import { DashboardEvidenceList, DashboardFilterBar, DashboardStateNotice, DashboardUnavailableNotice, MetricTabs, TodayTaskList, type AssigneeOption } from "@/components/dash/drilldown";
import { StatCard } from "@/components/dash/widgets";
import { getSession } from "@/lib/auth/session";
import { getCrmService } from "@/lib/crm";
import { canReassign, dashboardHref, dueDateOf, filterDashboardDeals, isTaskDone, parseDashboardFilters } from "@/lib/dash/drilldown";
import { FEATURES } from "@/lib/product";

function todayInKorea(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shortId(id: string): string {
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export default async function DashboardTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const filters = parseDashboardFilters(query);
  const result = typeof query.result === "string" ? query.result : null;
  const ctx = await getSession();
  const service = getCrmService();
  const loaded = await Promise.all([service.listDeals(ctx), service.listPipelines(ctx)])
    .then(([visibleDeals, pipelines]) => ({ visibleDeals, pipelines }))
    .catch(() => null);
  if (!loaded) {
    return (
      <div className="flex flex-col gap-6">
        <nav className="text-sm text-zinc-500"><Link href="/" className="hover:underline">대시보드</Link><span className="mx-1.5">/</span><span>업무 근거 목록</span></nav>
        <DashboardUnavailableNotice />
      </div>
    );
  }
  const { visibleDeals, pipelines } = loaded;
  const today = todayInKorea();
  const evidence = filterDashboardDeals(visibleDeals, filters, today);
  const todayDeals = visibleDeals.filter((deal) => dueDateOf(deal) === today && !isTaskDone(deal));
  const overdueDeals = visibleDeals.filter((deal) => {
    const due = dueDateOf(deal);
    return Boolean(due && due < today && !isTaskDone(deal));
  });
  const newDeals = visibleDeals.filter((deal) => deal.created_at.slice(0, 10) === today);
  const assigneeIds = new Set(visibleDeals.map((deal) => deal.assigned_to).filter((id): id is string => Boolean(id)));
  assigneeIds.add(ctx.user.id);
  const assignees: AssigneeOption[] = [...assigneeIds].map((id) => ({ id, label: id === ctx.user.id ? "나" : `담당자 ${shortId(id)}` }));
  const returnTo = dashboardHref(filters, {});

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-sm text-zinc-500"><Link href="/" className="hover:underline">대시보드</Link><span className="mx-1.5">/</span><span>업무 근거 목록</span></nav>
      <FeatureGateServer orgId={ctx.org.id} feature={FEATURES.dash} label="대시보드">
        <div className="flex flex-col gap-6">
          <header><h1 className="text-xl font-semibold">업무 현황 자세히 보기</h1></header>
          <DashboardFilterBar filters={filters} pipelines={pipelines} assignees={assignees} />
          <DashboardStateNotice result={result} overdueCount={overdueDeals.length} />
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="업무 지표">
            <Link href={dashboardHref(filters, { metric: "all" })}><StatCard label="보이는 업무" value={visibleDeals.length} /></Link>
            <Link href={dashboardHref(filters, { metric: "today" })}><StatCard label="오늘 할 일" value={todayDeals.length} /></Link>
            <Link href={dashboardHref(filters, { metric: "overdue" })}><StatCard label="기한 지남" value={overdueDeals.length} /></Link>
            <Link href={dashboardHref(filters, { metric: "new" })}><StatCard label="오늘 등록" value={newDeals.length} /></Link>
          </section>
          <section className="space-y-3"><h2 className="text-base font-semibold">오늘 할 일</h2><TodayTaskList deals={todayDeals} assignees={assignees} canChangeAssignee={canReassign(ctx)} returnTo={returnTo} today={today} /></section>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">같은 권한 기준 근거 목록</h2><MetricTabs filters={filters} /></div>
            <p className="text-xs text-zinc-500">지표와 목록은 로그인한 회사·역할·담당 범위에 동일한 조회 결과를 사용해요.</p>
            <DashboardEvidenceList deals={evidence} pipelines={pipelines} />
          </section>
        </div>
      </FeatureGateServer>
    </div>
  );
}
