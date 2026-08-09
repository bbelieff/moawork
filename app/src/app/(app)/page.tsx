import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { getRepo } from "@/lib/repo";
import { FeatureGateServer } from "@/components/auth/FeatureGateServer";
import { FEATURES } from "@/lib/product";
import { buildDashboard } from "@/lib/dash";
import { formatCount, formatKrw, formatMonth, orEmpty } from "@/lib/dash/format";
import {
  ContractStatusWidget,
  ConversionWidget,
  PipelineWidget,
  ReContactWidget,
  SettlementWidget,
  StatCard,
  Widget,
} from "@/components/dash/widgets";
import { RecentNotices } from "@/components/dash/RecentNotices";
import { getNoticesService } from "@/lib/notices";
import type { MemberRole } from "@/lib/types";
import { PlatformAccessNotice } from "@/components/platform/PlatformAccessNotice";

// 홈 = core.dash 메인 대시보드 (T04).
// 수치는 전부 deals/stages/field_defs 에서 **파생**한다(이중저장 없음).
// 담당범위(assigned) 격리는 repo.listDeals(ctx) 가 적용 → member 는 본인 담당 기준 숫자.
// ?as=owner|admin|member 로 역할·담당범위를 바꿔 스코프 격리를 시연한다.
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

  const dash = buildDashboard(ctx, { month });
  const repo = getRepo();
  const pipelines = repo.listPipelines(ctx.org.id);

  // 최근 공지 — 003 보드 엔진(공지 보드)에서 파생. 상단고정 우선 정렬은 서비스가 적용.
  const recentNotices = getNoticesService().list(ctx, { limit: 5 });

  // "오늘 할 일" 목록용 — 담당범위(assigned)는 repo.listDeals(ctx) 가 적용한다.
  const myDeals = repo.listDeals(ctx);
  const stages = pipelines.flatMap((p) => repo.listStages(p.id));
  const stageName = (id: string | null) =>
    stages.find((s) => s.id === id)?.name ?? "-";

  const roles: MemberRole[] = ["owner", "admin", "member"];

  return (
    <div className="flex flex-col gap-6">
      <PlatformAccessNotice error={accessError} />
      {/* 개발용 역할 전환 — 운영에서는 렌더하지 않는다. */}
      {devToolsEnabled ? (
        <section className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-500">보기 역할(개발용):</span>
          {roles.map((r) => (
            <Link
              key={r}
              href={`/?as=${r}`}
              className={`rounded border px-2 py-1 text-xs ${
                ctx.role === r
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              {r}
            </Link>
          ))}
          <span className="ml-2 text-xs text-zinc-400">
            현재 {ctx.role}/{ctx.scope} — member+assigned 는 본인 담당만 집계됩니다.
          </span>
        </section>
      ) : null}

      {/* 제목은 게이트 **밖**이다 — core.dash 가 잠겨도 화면이 잠금 문구 한 줄로
          붕괴하지 않게 한다(P0 · 신규 회사 첫 진입). 잠금은 아래 영역에만 표시. */}
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">대시보드</h1>
        <span className="text-sm text-zinc-500">
          기준 {formatMonth(dash.month)} (KST)
        </span>
      </header>

      <FeatureGateServer
        orgId={ctx.org.id}
        feature={FEATURES.dash}
        label="대시보드(core.dash)"
      >
        <div className="flex flex-col gap-6">
          {/* 상단 고정 요약 */}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="전체 딜" value={formatCount(dash.totalDeals)} />
            <StatCard label="고객사" value={formatCount(dash.totalCompanies)} />
            <StatCard
              label="이번달 신규 딜"
              value={formatCount(dash.newDealsThisMonth)}
              hint={formatMonth(dash.month)}
            />
            <StatCard
              label="이번달 수납 총매출"
              value={orEmpty(
                dash.settlementThisMonth.available,
                dash.settlementThisMonth.totalRevenueSum,
                formatKrw,
              )}
              hint="수수료입금일 기준"
            />
          </section>

          {/* 최근 공지 — 003 보드 엔진 위의 공지 보드에서 파생 */}
          <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  📢 최근 공지
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  상단고정 우선 · 게시일 최신순
                </p>
              </div>
              <Link href="/notices" className="text-xs text-zinc-500 hover:underline">
                전체 보기 →
              </Link>
            </div>
            <RecentNotices
              notices={recentNotices}
              scopeLimited={ctx.scope === "assigned"}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Widget
              title="파이프라인 현황"
              subtitle="단계별 건수 · 전체 대비 비율"
            >
              <PipelineWidget data={dash.pipeline} />
            </Widget>

            <Widget
              title="전환율"
              subtitle="분모=전체 딜 · 분자=해당 단계 이상 도달"
            >
              <ConversionWidget rates={dash.conversions} />
            </Widget>

            <Widget
              title="계약상황"
              subtitle="field_defs '계약상황' 프리셋 기준"
            >
              <ContractStatusWidget data={dash.contractStatus} />
            </Widget>

            <Widget
              title="이번달 수납"
              subtitle="수수료입금일이 이번달인 건 (실현 기준)"
            >
              <SettlementWidget
                data={dash.settlementThisMonth}
                emptyHint="이번달 수납 건이 없습니다."
              />
            </Widget>

            <Widget title="전체 정산" subtitle="전 기간 누적">
              <SettlementWidget
                data={dash.settlementAll}
                emptyHint="정산 입력(실행액·수수료율)이 있는 딜이 없습니다."
              />
            </Widget>

            <Widget
              title="이번달 재접촉"
              subtitle="수수료입금일 + 180일 도래"
            >
              <ReContactWidget entries={dash.reContactThisMonth} />
            </Widget>
          </div>

          {/* 오늘 할 일 — 내 담당 딜 (PLAN §3 core.dash "홈 = 오늘 할 일 + 이번달 요약") */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              내 딜 ({formatCount(myDeals.length)})
            </h2>
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {myDeals.length === 0 ? (
                <li className="p-3 text-sm text-zinc-400">담당 딜이 없습니다.</li>
              ) : (
                myDeals.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 p-3 text-sm"
                  >
                    <span className="truncate">{d.title}</span>
                    <span className="shrink-0 text-zinc-500">{stageName(d.stage_id)}</span>
                  </li>
                ))
              )}
            </ul>
          </section>

          {/* 드릴다운: 보드(파이프라인)별 상세 */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              보드별 상세
            </h2>
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {pipelines.length === 0 ? (
                <li className="p-3 text-sm text-zinc-400">파이프라인이 없습니다.</li>
              ) : (
                pipelines.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/dash/${p.id}`}
                      className="flex items-center justify-between p-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <span>{p.name}</span>
                      <span className="text-zinc-400">→</span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      </FeatureGateServer>
    </div>
  );
}
