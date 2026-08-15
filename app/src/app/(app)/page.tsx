import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { FeatureGateServer } from "@/components/auth/FeatureGateServer";
import { FEATURES } from "@/lib/product";
import { loadDashboardPageData } from "@/lib/dash/server";
import { currentMonthKst } from "@/lib/dash/service";
import { formatCount, formatKrw, formatMonth, orEmpty } from "@/lib/dash/format";
import {
  ContractStatusWidget,
  ConversionWidget,
  FollowUpListWidget,
  PipelineWidget,
  ReContactWidget,
  SettlementWidget,
  StatCard,
  Widget,
} from "@/components/dash/widgets";
import { RecentNotices } from "@/components/dash/RecentNotices";
import {
  DashboardSourceSummary,
  DashboardUnavailable,
} from "@/components/dash/DashboardSourceSummary";
import type { MemberRole } from "@/lib/types";
import { PlatformAccessNotice } from "@/components/platform/PlatformAccessNotice";
import { ChecklistCompletionCell } from "@/components/policyfund/ChecklistCompletionCell";
import { SupabaseChecklistStore } from "@/lib/policyfund/checklist";
import { createClient } from "@/lib/supabase/server";

// 홈 = core.dash 메인 대시보드. 모든 영역은 같은 요청의 쿠키 결속 Supabase
// 클라이언트를 공유한다. 한 영역의 DB 실패를 0으로 바꾸지 않고 별도로 표시한다.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const asParam = typeof sp.as === "string" ? sp.as : undefined;
  const month = typeof sp.month === "string" ? sp.month : undefined;
  const accessError = typeof sp.error === "string" ? sp.error : undefined;

  const base = await getSession();
  const devToolsEnabled = process.env.NODE_ENV !== "production";
  const ctx = devToolsEnabled ? applyAs(base, asParam) : base;
  const model = await loadDashboardPageData(ctx, { month });
  const core = model.core.status === "ready" ? model.core.data : null;
  const checklistStore = new SupabaseChecklistStore(await createClient());
  const checklists = new Map(
    await Promise.all(
      (core?.deals ?? []).map(async (deal) => [
        deal.id,
        await checklistStore.getDealChecklist(ctx.org.id, deal.id),
      ] as const),
    ),
  );
  const displayMonth = core?.dash.month ?? month ?? currentMonthKst();
  const stageName = (id: string | null) =>
    core?.stages.find((stage) => stage.id === id)?.name ?? "-";
  const roles: MemberRole[] = ["owner", "admin", "member"];

  return (
    <div className="flex flex-col gap-6">
      <PlatformAccessNotice error={accessError} />
      {devToolsEnabled ? (
        <section className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-500">보기 역할(개발용):</span>
          {roles.map((role) => (
            <Link
              key={role}
              href={`/?as=${role}`}
              className={`rounded border px-2 py-1 text-xs ${
                ctx.role === role
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              {role}
            </Link>
          ))}
          <span className="ml-2 text-xs text-zinc-400">
            현재 {ctx.role}/{ctx.scope} — member+assigned 는 본인 담당만 집계됩니다.
          </span>
        </section>
      ) : null}

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">대시보드</h1>
        <span className="text-sm text-zinc-500">기준 {formatMonth(displayMonth)} (KST)</span>
      </header>

      <FeatureGateServer orgId={ctx.org.id} feature={FEATURES.dash} label="대시보드">
        <div className="flex flex-col gap-6">
          <DashboardSourceSummary boards={model.boards} ledger={model.ledger} />

          <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">📢 최근 공지</h2>
                <p className="mt-0.5 text-xs text-zinc-400">상단고정 우선 · 게시일 최신순</p>
              </div>
              <Link href="/notices" className="text-xs text-zinc-500 hover:underline">전체 보기 →</Link>
            </div>
            {model.notices.status === "ready" ? (
              <RecentNotices notices={[...model.notices.data]} scopeLimited={ctx.scope === "assigned"} />
            ) : (
              <DashboardUnavailable label="공지" />
            )}
          </section>

          {core === null ? (
            <DashboardUnavailable label="업체·업무·정산" />
          ) : (
            <>
              <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="전체 업무" value={formatCount(core.dash.totalDeals)} href="/dash/all" />
                <StatCard label="고객사" value={formatCount(core.dash.totalCompanies)} href="/companies" />
                <StatCard
                  label="이번 달 신규 업무"
                  value={formatCount(core.dash.newDealsThisMonth)}
                  hint={formatMonth(core.dash.month)}
                  href="/dash/all?range=month"
                />
                <StatCard
                  label="이번달 수납 총매출"
                  value={orEmpty(
                    core.dash.settlementThisMonth.available,
                    core.dash.settlementThisMonth.totalRevenueSum,
                    formatKrw,
                  )}
                  hint="수수료입금일 기준"
                  href="/dash/all?range=month&paid=1"
                />
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <Widget title="파이프라인 현황" subtitle="단계별 건수 · 전체 대비 비율">
                  <PipelineWidget data={core.dash.pipeline} />
                </Widget>
                <Widget title="전환율" subtitle="전체 업무 중 해당 단계 이상 도달한 비율">
                  <ConversionWidget rates={core.dash.conversions} />
                </Widget>
                <Widget title="계약상황" subtitle="등록된 계약상황 기준">
                  <ContractStatusWidget data={core.dash.contractStatus} />
                </Widget>
                <Widget title="이번달 수납" subtitle="수수료입금일이 이번달인 건 (실현 기준)">
                  <SettlementWidget
                    data={core.dash.settlementThisMonth}
                    emptyHint="이번 달 수납 내역이 아직 없어요. 수수료입금일이 이번 달인 업무가 생기면 여기에 보여요."
                  />
                </Widget>
                <Widget title="전체 정산" subtitle="전 기간 누적">
                  <SettlementWidget
                    data={core.dash.settlementAll}
                    emptyHint="정산 정보가 있는 업무가 아직 없어요. 실행액과 수수료율이 입력된 업무가 생기면 여기에 보여요."
                  />
                </Widget>
                <Widget title="이번달 재접촉" subtitle="수수료입금일 + 180일 도래">
                  <ReContactWidget entries={core.dash.reContactThisMonth} />
                </Widget>
                <Widget
                  title={`오늘 할 일 (${formatCount(core.followUps.dueToday.length)})`}
                  subtitle={`재접촉(D+180)·재신청 안내(D+365) · 내일 ${formatCount(core.followUps.dueTomorrow.length)}건 예정`}
                >
                  <FollowUpListWidget entries={core.followUps.dueToday} emptyHint="오늘 재접촉·재신청 안내할 업무가 없어요." />
                </Widget>
              </div>

              <section>
                <div className="mb-2">
                  <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                    내 업무 ({formatCount(core.deals.length)})
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500">업무는 업체와 진행하는 각각의 일입니다.</p>
                </div>
                <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
                      <tr>
                        <th className="p-3 font-medium">업무</th>
                        <th className="p-3 font-medium">단계</th>
                        <th className="p-3 font-medium">서류 준비</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {core.deals.length === 0 ? (
                        <tr><td colSpan={3} className="p-3 text-zinc-400">업무 담당자로 지정되면 여기에 보여요.</td></tr>
                      ) : core.deals.map((deal) => (
                        <tr key={deal.id}>
                          <td className="p-3"><Link href={`/deals/${deal.id}`} className="hover:underline">{deal.title}</Link></td>
                          <td className="p-3 text-zinc-500">{stageName(deal.stage_id)}</td>
                          <td className="p-3"><ChecklistCompletionCell items={checklists.get(deal.id)?.items ?? []} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">보드별 상세</h2>
                <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {core.pipelines.length === 0 ? (
                    <li className="p-3 text-sm text-zinc-400">파이프라인이 없습니다.</li>
                  ) : core.pipelines.map((pipeline) => (
                    <li key={pipeline.id}>
                      <Link href={`/dash/${pipeline.id}`} className="flex items-center justify-between p-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                        <span>{pipeline.name}</span><span className="text-zinc-400">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </FeatureGateServer>
    </div>
  );
}
