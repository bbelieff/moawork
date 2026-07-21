// T07 · mod.perf 조립 계층.
//
// Repo(담당범위 적용 조회) → 순수 집계(aggregate.ts) 로 성과 데이터를 만든다.
// 저장하지 않는다(이중저장 금지) — 매 요청 원본에서 파생.
//
// **배선 상태(B5)**: 이 계층은 `@/lib/repo` 포트만 의존한다. 현재 구현체는 LocalRepo(인메모리)이고
// B2 가 Supabase 어댑터로 교체하면 **이 파일 수정 없이** 실 DB 로 전환된다(어댑터 스왑).
// 따라서 B5 는 집계 인터페이스 + 위젯까지 선구현하고, 배선 변경은 B2 몫이다.

import { currentMonthKst } from "@/lib/dash/service";
import { getRepo, type Repo } from "@/lib/repo";
import type { Ctx, User } from "@/lib/types";
import { buildLeaderboard, buildMonthlyContractCompanies } from "./aggregate";
import type { Leaderboard, LeaderboardSort, MonthlyContractCompanies } from "./types";

export { currentMonthKst };

export interface PerfOptions {
  /** 기준 월(YYYY-MM). 미지정 시 KST 현재월. */
  period?: string;
  /** 리더보드 정렬 기준. 기본 수수료합. */
  sort?: LeaderboardSort;
  /** 현재 시각 주입(테스트 결정성). */
  now?: () => Date;
  /** Repo 주입(테스트). 기본은 getRepo(). */
  repo?: Repo;
}

/** 성과 화면 1개에 필요한 파생 수치. */
export interface PerfData {
  period: string;
  leaderboard: Leaderboard;
  contractCompanies: MonthlyContractCompanies;
}

/**
 * 조직 구성원 목록 — 표시명 조회용.
 * 전역 listUsers() 가 아니라 org 멤버십을 거쳐 조회한다(타 조직 사용자 유출 방지).
 */
function orgUsers(repo: Repo, orgId: string): User[] {
  return repo
    .listMembers(orgId)
    .map((m) => m.user)
    .filter((u): u is User => u !== undefined);
}

/**
 * 담당자별 실적 리더보드를 조립한다.
 * 담당범위(assigned) 격리는 repo.listSettlements(ctx)/listDeals(ctx) 가 적용한다.
 */
export function getLeaderboard(ctx: Ctx, opts: PerfOptions = {}): Leaderboard {
  const repo = opts.repo ?? getRepo();
  const period = opts.period ?? currentMonthKst(opts.now?.() ?? new Date());
  return buildLeaderboard(
    repo.listSettlements(ctx),
    repo.listDeals(ctx),
    orgUsers(repo, ctx.org.id),
    period,
    opts.sort ?? "fee",
  );
}

/** 이달의 계약회사 위젯 데이터를 조립한다. */
export function getMonthlyContractCompanies(
  ctx: Ctx,
  opts: PerfOptions = {},
): MonthlyContractCompanies {
  const repo = opts.repo ?? getRepo();
  const period = opts.period ?? currentMonthKst(opts.now?.() ?? new Date());
  return buildMonthlyContractCompanies(
    repo.listSettlements(ctx),
    repo.listDeals(ctx),
    repo.listCompanies(ctx),
    period,
  );
}

/** 성과 화면 전체를 한 번에 조립한다(Repo 조회 1회분 공유). */
export function buildPerf(ctx: Ctx, opts: PerfOptions = {}): PerfData {
  const repo = opts.repo ?? getRepo();
  const period = opts.period ?? currentMonthKst(opts.now?.() ?? new Date());

  const settlements = repo.listSettlements(ctx);
  const deals = repo.listDeals(ctx);

  return {
    period,
    leaderboard: buildLeaderboard(
      settlements,
      deals,
      orgUsers(repo, ctx.org.id),
      period,
      opts.sort ?? "fee",
    ),
    contractCompanies: buildMonthlyContractCompanies(
      settlements,
      deals,
      repo.listCompanies(ctx),
      period,
    ),
  };
}
