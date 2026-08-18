import Link from "next/link";
import { FeatureGateServer } from "@/components/auth/FeatureGateServer";
import { FEATURES } from "@/lib/product";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import type { Ctx } from "@/lib/types";
import type { TodayHomeState } from "@/lib/dash/today-server";
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
import { ChecklistCompletionCell } from "@/components/policyfund/ChecklistCompletionCell";
import { SupabaseChecklistStore } from "@/lib/policyfund/checklist";
import { createClient } from "@/lib/supabase/server";

// 「회사 현황」 — 홈 한 화면의 아래쪽 절(총괄 확정, BBE-215).
//
// 홈(V6 «오늘»)은 «오늘 뭘 해야 하나» 만 답한다. 파이프라인·전환율·계약상황·정산·재접촉·
// 후속연락·내 업무 목록은 **버리지 않고 여기로 옮겼다**(§9.3 «비우기지 지우기가 아니다»).
// 위젯·데이터·문구는 옮기기 전 홈과 같은 것을 그대로 쓴다 — 옮김이지 다시 만든 게 아니다.
//
// 진입점: 없다 — 홈 한 화면의 아래 절이라 «가는 링크» 가 필요 없다(BBE-215 로 바로가기를 뺐다).
//   사이드바(nav-items.ts)는 목업 D05 정본이라 건드리지 않았다.
/**
 * 「이번달 수납」 — RPC 가 정본이다(BBE-215 (A)).
 *
 * ★ 0 을 «세 상태» 로 가른다. 그냥 0 만 보여주면 「수납이 없다」와 「아무도 입금일을 안 채웠다」가
 *   같은 화면이 된다 — 그건 다른 사실이고, 사용자가 할 일도 다르다.
 *     · 탭이 없다        → missingSources 에 'work'
 *     · 입금일 미입력     → unfilledColumns 에 그 컬럼 이름 (DC-12 가 088 에서 내보낸다)
 *     · 진짜 0           → 위 둘 다 아님
 */
function MonthlyCollection({ today }: { today: TodayHomeState }) {
  if (today.kind !== "ready") {
    return <DashboardUnavailable label="이번달 수납" />;
  }
  const { kpis, unfilledColumns, missingSources } = today.snapshot;
  const total = kpis.contractDeposits + kpis.fees;

  if (missingSources.includes("work")) {
    return (
      <p className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
        계약업체 실무 탭이 아직 없어요. 탭을 만들면 이번 달 수납이 여기에 보여요.
      </p>
    );
  }
  const unfilled = ["contract_deposit_paid_on", "fee_paid_on"].filter((column) =>
    unfilledColumns.includes(column),
  );
  if (total === 0 && unfilled.length > 0) {
    return (
      <p className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
        입금일이 아직 입력되지 않았어요. 계약업체 실무 탭에서 «계약금 수납일 · 수수료 수납일» 을
        채우면 이번 달 수납이 여기에 보여요.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-[var(--sp-1)]">
      <p className="text-[length:var(--fs-18)] font-semibold text-[var(--mw-t-1)]">{formatKrw(total)}</p>
      <p className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
        계약금 {formatKrw(kpis.contractDeposits)} · 수수료 {formatKrw(kpis.fees)}
      </p>
      {total === 0 ? (
        <p className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
          이번 달 수납이 아직 없어요.
        </p>
      ) : null}
    </div>
  );
}

export async function CompanyStatusSection({
  ctx,
  month,
  today,
}: {
  ctx: Ctx;
  month?: string;
  /**
   * ★ 홈이 이미 부른 `loadTodayHome` 결과를 «받아서» 쓴다. 여기서 다시 부르지 않는다 —
   *   같은 RPC 를 두 번 부르면 왕복이 늘고, 무엇보다 «같은 화면의 두 숫자» 가 갈릴 수 있다.
   */
  today: TodayHomeState;
}) {

  const header = (
    <header className="flex flex-wrap items-baseline justify-between gap-[var(--sp-2)]">
      <div>
        <h2 className="text-[length:var(--fs-18)] font-semibold text-[var(--mw-t-1)]">회사 현황</h2>
        <p className="mt-[var(--sp-1)] text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
          내 권한으로 볼 수 있는 업무만 같은 기준으로 집계합니다.
        </p>
      </div>
    </header>
  );

  // 홈과 같은 이유로 가드가 필요하다 — createClient() 는 환경변수가 없으면 throw 한다.
  // ★ 조건은 `canUseLocalSeedFallback()` 이다(BBE-203). 이 아래 체크리스트 블록은 BBE-203 이
  //   홈에서 고쳐 둔 바로 그 코드를 BBE-186 이 여기로 옮긴 것이라, 규칙도 같이 와야 한다.
  //   env 유무«만» 보는 느슨한 규칙으로 갈리면 운영에서 env 가 빠졌을 때 조용히 «불러오지 못함» 만 뜬다.
  if (canUseLocalSeedFallback()) {
    return (
      <div className="flex flex-col gap-[var(--sp-4)]">
        {header}
        <DashboardUnavailable label="회사 현황" />
      </div>
    );
  }

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

  return (
    <div className="flex flex-col gap-6">
      {header}
      <span className="text-sm text-zinc-500">기준 {formatMonth(displayMonth)} (KST)</span>

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
                {/* ★ BBE-215 (A) — 이 축만은 «앱이 계산하지 않는다». RPC 값을 그대로 받는다.
                     같은 화면 위쪽 KPI 줄의 「이번 달 수수료」와 «같은 출처» 여야 두 숫자가 안 갈린다.
                     예전에는 앱이 settlements+deals 로 따로 계산했고, settlements 에 쓰는 코드가
                     없어서(BBE-231) 사실상 «항상 deal.amount 추정치» 였다. 추정 → 실현으로 바뀐다. */}
                <Widget title="이번달 수납" subtitle="수수료입금일·계약금입금일이 이번달인 건 (실현 기준)">
                  <MonthlyCollection today={today} />
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
                {/*
                  홈의 «내 할 일»(BBE-185 tasks)과 **이름만 같고 다른 물건**이라 여기서 이름을 바꿨다.
                  이건 재접촉(D+180)·재신청 안내(D+365) 도래 목록이고, 홈 쪽은 기한 도래 업무다.
                  같은 이름이 두 화면에 있으면 사용자도 다음 세션도 헷갈린다.
                */}
                <Widget
                  title={`재접촉·재신청 대상 (${formatCount(core.followUps.dueToday.length)})`}
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
