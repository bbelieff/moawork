import Link from "next/link";
import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { getCrmService } from "@/lib/crm";
import { createRequestCustomService } from "@/lib/custom/server";
import { FeatureGateServer } from "@/components/auth/FeatureGateServer";
import { FEATURES } from "@/lib/product";
import {
  contractStatusBreakdown,
  conversionRate,
  pipelineBreakdown,
  POLICYFUND_FIELD_KEYS,
  sumAmounts,
} from "@/lib/dash";
import { EMPTY, formatCount, formatKrw, formatPercent } from "@/lib/dash/format";
import {
  ContractStatusWidget,
  ConversionWidget,
  PipelineWidget,
  StatCard,
  Widget,
} from "@/components/dash/widgets";
import type { Deal, FieldDef } from "@/lib/types";

// 보드(파이프라인)별 상세 — 대시보드 드릴다운 (T04).
// 해당 파이프라인의 딜만 집계하고, 단계별로 딜을 나열한다.
// ⚠ 딜 상세(아이템 상세) 화면은 T02 core.crm 소유 — 여기서는 요약 행만 보여준다.
export default async function PipelineDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ pipelineId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { pipelineId } = await params;
  const sp = await searchParams;
  const asParam = typeof sp.as === "string" ? sp.as : undefined;

  const base = await getSession();
  const ctx = applyAs(base, asParam);

  const custom = await createRequestCustomService();
  const [pipelines, allDeals, fieldDefs] = await Promise.all([
    getCrmService().listPipelines(ctx),
    getCrmService().listDeals(ctx),
    custom.listFields(ctx.org.id, "deal"),
  ]);
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  if (!pipeline) notFound();

  const stages = pipeline.stages;
  // 담당범위 적용 조회 후 이 파이프라인 소속 딜만.
  const deals = allDeals.filter((d) => d.pipeline_id === pipeline.id);

  const breakdown = pipelineBreakdown(deals, stages);
  const conversions = [
    conversionRate(deals, stages, "meeting"),
    conversionRate(deals, stages, "contract"),
    conversionRate(deals, stages, "settle"),
  ];
  const contractStatus = contractStatusBreakdown(deals, fieldDefs);

  const ordered = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const dealsByStage = new Map<string, Deal[]>(ordered.map((s) => [s.id, []]));
  const unassigned: Deal[] = [];
  for (const d of deals) {
    const bucket = d.stage_id ? dealsByStage.get(d.stage_id) : undefined;
    if (bucket) bucket.push(d);
    else unassigned.push(d);
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-sm text-zinc-500">
        <Link href="/" className="hover:underline">
          대시보드
        </Link>
        <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">/</span>
        <span className="text-zinc-700 dark:text-zinc-200">{pipeline.name}</span>
      </nav>

      <FeatureGateServer
        orgId={ctx.org.id}
        feature={FEATURES.dash}
        label="대시보드"
      >
        <div className="flex flex-col gap-6">
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="업무" value={formatCount(breakdown.total)} />
            <StatCard label="단계" value={formatCount(ordered.length)} />
            <StatCard label="단계 미지정" value={formatCount(breakdown.unassigned)} />
            <StatCard label="금액 합계" value={formatKrw(sumAmounts(deals))} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Widget title="단계별 현황" subtitle="이 보드 기준">
              <PipelineWidget data={breakdown} />
            </Widget>
            <Widget title="전환율" subtitle="이 보드의 전체 업무 기준">
              <ConversionWidget rates={conversions} />
            </Widget>
            <Widget title="계약상황" subtitle="등록된 계약상황 기준">
              <ContractStatusWidget data={contractStatus} />
            </Widget>
          </div>

          {/* 단계별 딜 목록 */}
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              단계별 업무
            </h2>
            {ordered.map((s) => {
              const list = dealsByStage.get(s.id) ?? [];
              return (
                <div key={s.id}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-zinc-700 dark:text-zinc-200">
                      {s.name}
                    </span>
                    <span className="tabular-nums text-zinc-500">
                      {formatCount(list.length)}건 ·{" "}
                      {formatPercent(
                        breakdown.stages.find((x) => x.stageId === s.id)?.ratio ?? 0,
                      )}
                    </span>
                  </div>
                  <DealList deals={list} fieldDefs={fieldDefs} />
                </div>
              );
            })}

            {unassigned.length > 0 ? (
              <div>
                <div className="mb-1 text-sm font-medium text-zinc-500">
                  단계 미지정 ({formatCount(unassigned.length)}건)
                </div>
                <DealList deals={unassigned} fieldDefs={fieldDefs} />
              </div>
            ) : null}
          </section>
        </div>
      </FeatureGateServer>
    </div>
  );
}

/** 딜 요약 행 목록. 딜 상세 화면은 T02 소유이므로 여기서는 링크하지 않는다. */
function DealList({
  deals,
  fieldDefs,
}: {
  deals: Deal[];
  fieldDefs: FieldDef[];
}) {
  const statusDef = fieldDefs.find(
    (f) => f.entity === "deal" && f.key === POLICYFUND_FIELD_KEYS.contractStatus,
  );
  const labelOf = (d: Deal): string => {
    if (!statusDef?.options_jsonb) return EMPTY;
    const raw = d.custom?.[statusDef.key];
    if (typeof raw !== "string") return EMPTY;
    const opt = statusDef.options_jsonb.options.find(
      (o) => o.id === raw || o.label === raw,
    );
    return opt?.label ?? EMPTY;
  };

  if (deals.length === 0) {
    return (
      <p className="rounded border border-dashed border-zinc-200 p-3 text-xs text-zinc-400 dark:border-zinc-800">
        이 단계에 업무가 등록되면 여기에 보여요.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {deals.map((d) => (
        <li
          key={d.id}
          className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
        >
          <span className="text-zinc-800 dark:text-zinc-100">{d.title}</span>
          <span className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{labelOf(d)}</span>
            <span className="tabular-nums">
              {d.amount === null ? EMPTY : formatKrw(d.amount)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
