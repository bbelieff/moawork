// T07 · mod.perf 조립 계층.
//
// Repo(담당범위 적용 조회) → 순수 집계(aggregate.ts) 로 성과 데이터를 만든다.
// 저장하지 않는다(이중저장 금지) — 매 요청 원본에서 파생.
//
// **배선 상태(B5)**: 이 계층은 `@/lib/repo` 포트만 의존한다. 현재 구현체는 LocalRepo(인메모리)이고
// B2 가 Supabase 어댑터로 교체하면 **이 파일 수정 없이** 실 DB 로 전환된다(어댑터 스왑).
// 따라서 B5 는 집계 인터페이스 + 위젯까지 선구현하고, 배선 변경은 B2 몫이다.

// 배럴(@/lib/crm)이 아니라 의존성 0 인 errors 모듈에서 직접 가져온다 —
// 배럴은 requireCtx → auth/session → @supabase/ssr 까지 끌고 들어와
// 순수 집계 계층을 서버 전용으로 만든다.
import { ForbiddenError } from "@/lib/crm/errors";
import { currentMonthKst } from "@/lib/dash/service";
import { getRepo, type Repo } from "@/lib/repo";
import type { Ctx, PerformanceSnapshot, User } from "@/lib/types";
import { buildLeaderboard, buildMonthlyContractCompanies } from "./aggregate";
import { resolveActiveRule } from "./incentive";
import { buildSnapshotRows } from "./snapshot";
import { getPerfStore, type PerfStore } from "./store";
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
  /** PerfStore 주입(테스트). 기본은 getPerfStore(). */
  store?: PerfStore;
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

/**
 * 스냅샷 재계산 권한 확인.
 *
 * **owner/admin 만** 허용하는 이유는 UI 가리기가 아니라 **정확성**이다.
 * `repo.listSettlements(ctx)` 는 담당범위를 적용하므로 `member+assigned` 사용자가
 * 호출하면 "본인 담당 정산"만 보이고, 그 부분집합으로 조직 전체 스냅샷을 덮어써
 * 다른 사람들의 그 달 실적이 **0으로 지워진다**. 조직 전체를 볼 수 있는 호출자만
 * 재계산할 수 있어야 한다(포트의 스코프 규칙: owner/admin 또는 scope='all' = 전체).
 */
function requireOrgWideReader(ctx: Ctx): void {
  const orgWide = ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all";
  if (!orgWide) {
    throw new ForbiddenError(
      "성과 스냅샷 재계산은 조직 전체를 조회할 수 있는 관리자만 가능합니다",
    );
  }
}

/** 재계산 결과 — 배치/버튼 양쪽이 같은 형태로 보고한다. */
export interface RecomputeResult {
  period: string;
  /** 저장된 스냅샷 행 수(미배정 버킷 포함). */
  rowCount: number;
  /** 적용된 인센티브 규칙명. 규칙이 없으면 null(인센티브 전부 0). */
  ruleName: string | null;
  snapshots: PerformanceSnapshot[];
}

/**
 * 월 스냅샷을 재계산해 저장한다(설계 §2.4).
 *
 * 멱등이다 — 같은 소스로 다시 돌리면 같은 결과이며, 해당 org+period 를 통째로
 * 교체하므로 사라진 담당자의 옛 행도 함께 정리된다.
 *
 * @throws ForbiddenError 조직 전체를 조회할 수 없는 호출자면.
 * @throws IncentiveConfigError 인센티브 규칙 설정이 잘못됐으면(부분 저장 없음 —
 *         행을 다 만든 뒤에 저장하므로 오류 시 기존 스냅샷이 그대로 남는다).
 */
export function recomputeSnapshots(
  ctx: Ctx,
  opts: PerfOptions = {},
): RecomputeResult {
  requireOrgWideReader(ctx);

  const repo = opts.repo ?? getRepo();
  const store = opts.store ?? getPerfStore();
  const period = opts.period ?? currentMonthKst(opts.now?.() ?? new Date());

  const rule = resolveActiveRule(store.listRules(ctx.org.id));
  const rows = buildSnapshotRows(
    repo.listSettlements(ctx),
    repo.listDeals(ctx),
    period,
    rule,
  );

  const snapshots = store.replaceSnapshots(ctx.org.id, period, rows);

  return {
    period,
    rowCount: snapshots.length,
    ruleName: rule?.name ?? null,
    snapshots,
  };
}

/** 저장된 스냅샷 조회. 리더보드와 달리 **캐시된 값**을 그대로 돌려준다. */
export function listSnapshots(
  ctx: Ctx,
  opts: PerfOptions = {},
): PerformanceSnapshot[] {
  const store = opts.store ?? getPerfStore();
  return store.listSnapshots(ctx.org.id, opts.period);
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
