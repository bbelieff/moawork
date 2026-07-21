import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { getRepo } from "@/lib/repo";
import { FeatureGate } from "@/components/auth/FeatureGate";
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
import type { MemberRole } from "@/lib/types";

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

  const base = await getSession();
  const ctx = applyAs(base, asParam);

  const dash = buildDashboard(ctx, { month });
  const pipelines = getRepo().listPipelines(ctx.org.id);

  const roles: MemberRole[] = ["owner", "admin", "member"];

  return (
    <div className="flex flex-col gap-6">
      {/* 개발용 역할 전환 — 담당범위 격리 시연 */}
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

      <FeatureGate ctx={ctx} feature={FEATURES.dash} label="대시보드(core.dash)">
        <div className="flex flex-col gap-6">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-lg font-semibold">대시보드</h1>
            <span className="text-sm text-zinc-500">
              기준 {formatMonth(dash.month)} (KST)
            </span>
          </header>

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
      </FeatureGate>
    </div>
  );
}
