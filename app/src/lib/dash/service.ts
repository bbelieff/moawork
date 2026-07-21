// T04 · core.dash 조립 계층.
//
// Repo(담당범위 적용 조회) → 순수 집계(aggregate.ts) 로 대시보드 데이터를 만든다.
// 저장하지 않는다(이중저장 금지) — 매 요청 원본에서 파생.
//
// 지표 라벨 주의(T07 설계 §대시보드 지표 충돌):
//   - "계약단계 도달" = 파이프라인 KPI (stage.kind='contract' 첫 단계 이상 도달)
//   - "이번달 수납"   = 실현 기준 (수수료입금일이 해당 월)
//   두 수치는 다르다. 화면에서 라벨을 섞지 않는다.

import { getRepo, type Repo } from "@/lib/repo";
import type { Ctx, Deal, Stage } from "@/lib/types";
import {
  contractStatusBreakdown,
  conversionRate,
  filterDealsByRange,
  monthRangeKst,
  pipelineBreakdown,
  reContactDue,
  reContactList,
  settlementSummary,
  sumAmounts,
  toSettlementInputs,
} from "./aggregate";
import type {
  ContractStatusBreakdown,
  ConversionRate,
  DateRange,
  PipelineBreakdown,
  ReContactEntry,
  SettlementSummary,
} from "./types";

/** 대시보드 1화면에 필요한 모든 파생 수치. */
export interface DashboardData {
  /** 기준 월 (YYYY-MM, KST). */
  month: string;
  range: DateRange;

  /** 전체(담당범위 적용) 딜/고객사 수. */
  totalDeals: number;
  totalCompanies: number;
  /** 이번달 생성된 딜 수. */
  newDealsThisMonth: number;
  /** 딜 amount 합계(전체). */
  amountSum: number;

  pipeline: PipelineBreakdown;
  /** 계약/실행 단계 도달 전환율 — 파이프라인 KPI. */
  conversions: ConversionRate[];
  contractStatus: ContractStatusBreakdown;

  /** 전체 기간 정산 요약. */
  settlementAll: SettlementSummary;
  /** 이번달 **수납**(수수료입금일 기준) 정산 요약. */
  settlementThisMonth: SettlementSummary;

  /** 이번달 재접촉 대상(D+180). */
  reContactThisMonth: ReContactEntry[];
}

export interface BuildOptions {
  /** 기준 월(YYYY-MM). 미지정 시 now 기준 KST 현재월. */
  month?: string;
  /** 현재 시각 주입(테스트 결정성). */
  now?: () => Date;
  /** Repo 주입(테스트). 기본은 getRepo(). */
  repo?: Repo;
}

/** KST 기준 현재 월(YYYY-MM). */
export function currentMonthKst(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 7);
}

/** 조직의 모든 파이프라인 단계를 한 배열로. */
function allStages(repo: Repo, orgId: string): Stage[] {
  return repo.listPipelines(orgId).flatMap((p) => repo.listStages(p.id));
}

/** 수수료입금일이 구간에 드는 딜만. */
function dealsPaidIn(deals: readonly Deal[], range: DateRange): Deal[] {
  return toSettlementInputs(deals)
    .filter((e) => e.input.feeDepositDate !== null)
    .filter((e) => {
      const t = e.input.feeDepositDate!.getTime();
      return t >= Date.parse(range.start) && t < Date.parse(range.end);
    })
    .map((e) => e.deal);
}

/**
 * 대시보드 데이터를 조립한다.
 * 담당범위(assigned) 격리는 repo.listDeals(ctx)/listCompanies(ctx) 가 적용한다.
 */
export function buildDashboard(ctx: Ctx, opts: BuildOptions = {}): DashboardData {
  const repo = opts.repo ?? getRepo();
  const now = opts.now?.() ?? new Date();
  const month = opts.month ?? currentMonthKst(now);
  const range = monthRangeKst(month);

  const deals = repo.listDeals(ctx);
  const companies = repo.listCompanies(ctx);
  const stages = allStages(repo, ctx.org.id);
  const fieldDefs = repo.listFieldDefs(ctx.org.id, "deal");

  const settlementEntries = toSettlementInputs(deals);
  const paidThisMonth = dealsPaidIn(deals, range);

  return {
    month,
    range,

    totalDeals: deals.length,
    totalCompanies: companies.length,
    newDealsThisMonth: filterDealsByRange(deals, range).length,
    amountSum: sumAmounts(deals),

    pipeline: pipelineBreakdown(deals, stages),
    conversions: [
      conversionRate(deals, stages, "meeting"),
      conversionRate(deals, stages, "contract"),
      conversionRate(deals, stages, "settle"),
    ],
    contractStatus: contractStatusBreakdown(deals, fieldDefs),

    settlementAll: settlementSummary(settlementEntries),
    settlementThisMonth: settlementSummary(toSettlementInputs(paidThisMonth)),

    reContactThisMonth: reContactDue(reContactList(settlementEntries), range),
  };
}
