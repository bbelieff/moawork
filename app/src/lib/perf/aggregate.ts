// T07 · mod.perf 집계 엔진(순수 함수).
//
// 입력은 모두 호출부가 주입한다(Repo 조회 결과) — 이 파일은 I/O 를 하지 않는다.
// 따라서 담당범위(assigned) 격리는 상위(@/lib/repo listSettlements(ctx))에서 적용된 채로 들어온다.
//
// 기간 경계(monthRangeKst)·구간 판정(inRange)은 T04 core.dash 의 순수 헬퍼를 **재사용**한다.
// 월 경계 규칙을 두 벌 두면 대시보드와 리더보드의 "이번 달"이 어긋나므로 재작성 금지.
//
// 게이트 요건(T10 §3-A) 대응:
//   - 기간 경계(월초/월말, KST)          → monthRangeKst (dash 재사용)
//   - 데이터 0건일 때 0/'—'(NaN 없음)     → 빈 입력에서 모든 합계 0, available=false
//   - 이중저장 없음(원본 파생)            → 매 요청 계산(스냅샷 영속화는 Phase 2)

import { inRange, monthRangeKst } from "@/lib/dash/aggregate";
import type { DateRange } from "@/lib/dash/types";
import type { Company, Deal, Settlement, User } from "@/lib/types";
import type {
  ContractCompanyEntry,
  Leaderboard,
  LeaderboardRow,
  LeaderboardSort,
  MonthlyContractCompanies,
} from "./types";

export { monthRangeKst };

/** 미배정 버킷 표시명. */
export const UNASSIGNED_LABEL = "조직 공통";
/** 고객사 미연결 표시명. */
export const NO_COMPANY_LABEL = "(고객사 미지정)";
/** 이름·이메일이 모두 없는 사용자 표시명. */
export const NO_NAME_LABEL = "(이름없음)";

/**
 * 귀속월 필터 — `fee_paid_at`(수납일)이 구간에 드는 정산만.
 *
 * fee_paid_at 이 null 인 건은 **미실현**이므로 제외한다(설계 §2.1).
 * 이 함수가 리더보드·이달의계약회사의 공통 진입점이라, 두 위젯의 모집단이 항상 같다.
 */
export function settlementsPaidIn(
  settlements: readonly Settlement[],
  range: DateRange,
): Settlement[] {
  return settlements.filter((s) => inRange(s.fee_paid_at, range));
}

/** 사용자 표시명 — name → email → '(이름없음)'. */
export function displayName(user: User | undefined): string {
  if (!user) return NO_NAME_LABEL;
  const name = user.name?.trim();
  if (name) return name;
  const email = user.email?.trim();
  return email || NO_NAME_LABEL;
}

/** 정렬 기준별 비교값. */
function sortKey(row: LeaderboardRow, sort: LeaderboardSort): number {
  if (sort === "exec") return row.execSum;
  if (sort === "deals") return row.dealCount;
  return row.feeSum;
}

/**
 * 정렬 비교자 — 기준값 내림차순, 동점은 수수료 → 실행액 → 건수 → 이름 오름차순으로
 * tie-break 한다(설계 §4.3). 완전 결정적이라 렌더가 요청마다 흔들리지 않는다.
 */
function compareRows(sort: LeaderboardSort) {
  return (a: LeaderboardRow, b: LeaderboardRow): number => {
    const primary = sortKey(b, sort) - sortKey(a, sort);
    if (primary !== 0) return primary;
    if (b.feeSum !== a.feeSum) return b.feeSum - a.feeSum;
    if (b.execSum !== a.execSum) return b.execSum - a.execSum;
    if (b.dealCount !== a.dealCount) return b.dealCount - a.dealCount;
    return a.name.localeCompare(b.name, "ko");
  };
}

/**
 * 순위 부여 — 동점은 같은 순위를 공유하고 다음 순위를 건너뛴다(1,2,2,4).
 * 정렬 기준값이 같을 때만 동점으로 본다(tie-break 로 순서는 정해지지만 순위는 공유).
 */
function assignRanks(rows: LeaderboardRow[], sort: LeaderboardSort): LeaderboardRow[] {
  let lastValue: number | null = null;
  let lastRank = 0;
  return rows.map((row, i) => {
    const value = sortKey(row, sort);
    const rank = lastValue !== null && value === lastValue ? lastRank : i + 1;
    lastValue = value;
    lastRank = rank;
    return { ...row, rank };
  });
}

/** 누적기 — 담당자/고객사 공통. */
interface Bucket {
  dealCount: number;
  execSum: number;
  feeSum: number;
}

function emptyBucket(): Bucket {
  return { dealCount: 0, execSum: 0, feeSum: 0 };
}

function addTo(bucket: Bucket, s: Settlement): void {
  bucket.dealCount += 1;
  bucket.execSum += s.exec_amount;
  bucket.feeSum += s.fee_amount;
}

/**
 * 담당자별 실적 리더보드.
 *
 * 귀속: `settlement.deal_id → deal.assigned_to`. 딜이 없거나 담당자가 없으면
 * **미배정 버킷**으로 모으고 순위에서 제외한다(설계 §2.1).
 *
 * @param settlements 담당범위가 이미 적용된 정산 목록(전체 기간)
 * @param deals       담당범위가 이미 적용된 딜 목록(귀속 조인용)
 * @param users       표시명 조회용
 * @param period      기준 월(YYYY-MM, KST)
 */
export function buildLeaderboard(
  settlements: readonly Settlement[],
  deals: readonly Deal[],
  users: readonly User[],
  period: string,
  sort: LeaderboardSort = "fee",
): Leaderboard {
  const range = monthRangeKst(period);
  const paid = settlementsPaidIn(settlements, range);

  const dealById = new Map(deals.map((d) => [d.id, d]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const byUser = new Map<string, Bucket>();
  const unassignedBucket = emptyBucket();
  let hasUnassigned = false;

  for (const s of paid) {
    const deal = s.deal_id ? dealById.get(s.deal_id) : undefined;
    const userId = deal?.assigned_to ?? null;
    if (userId === null) {
      addTo(unassignedBucket, s);
      hasUnassigned = true;
      continue;
    }
    let bucket = byUser.get(userId);
    if (!bucket) {
      bucket = emptyBucket();
      byUser.set(userId, bucket);
    }
    addTo(bucket, s);
  }

  const ranked = assignRanks(
    [...byUser.entries()]
      .map(([userId, b]) => ({
        userId,
        name: displayName(userById.get(userId)),
        ...b,
        rank: null as number | null,
      }))
      .sort(compareRows(sort)),
    sort,
  );

  const unassigned: LeaderboardRow | null = hasUnassigned
    ? { userId: null, name: UNASSIGNED_LABEL, ...unassignedBucket, rank: null }
    : null;

  // 합계는 미배정을 포함한다 — 조직 전체 실적이므로.
  const totals = paid.reduce<Bucket>((acc, s) => {
    addTo(acc, s);
    return acc;
  }, emptyBucket());

  return { period, range, sort, rows: ranked, unassigned, totals };
}

/**
 * 이달의 계약회사 — `fee_paid_at` 이 기준월인 정산을 고객사별로 묶는다.
 *
 * 귀속: `settlement.deal_id → deal.company_id → company`. 고객사를 특정할 수 없는 건은
 * '(고객사 미지정)' 한 행으로 모은다(집계에서 누락시키면 합계가 리더보드와 어긋난다).
 */
export function buildMonthlyContractCompanies(
  settlements: readonly Settlement[],
  deals: readonly Deal[],
  companies: readonly Company[],
  period: string,
): MonthlyContractCompanies {
  const range = monthRangeKst(period);
  const paid = settlementsPaidIn(settlements, range);

  const dealById = new Map(deals.map((d) => [d.id, d]));
  const companyById = new Map(companies.map((c) => [c.id, c]));

  // key: companyId ?? "" (미지정)
  const byCompany = new Map<string, Bucket & { latestPaidAt: string }>();

  for (const s of paid) {
    const deal = s.deal_id ? dealById.get(s.deal_id) : undefined;
    const companyId = deal?.company_id ?? null;
    const key = companyId ?? "";
    let bucket = byCompany.get(key);
    if (!bucket) {
      bucket = { ...emptyBucket(), latestPaidAt: s.fee_paid_at! };
      byCompany.set(key, bucket);
    }
    addTo(bucket, s);
    // settlementsPaidIn 을 통과했으므로 fee_paid_at 은 non-null 이 보장된다.
    if (Date.parse(s.fee_paid_at!) > Date.parse(bucket.latestPaidAt)) {
      bucket.latestPaidAt = s.fee_paid_at!;
    }
  }

  const entries: ContractCompanyEntry[] = [...byCompany.entries()]
    .map(([key, b]) => ({
      companyId: key === "" ? null : key,
      name: key === "" ? NO_COMPANY_LABEL : (companyById.get(key)?.name ?? NO_COMPANY_LABEL),
      dealCount: b.dealCount,
      execSum: b.execSum,
      feeSum: b.feeSum,
      latestPaidAt: b.latestPaidAt,
    }))
    // 수수료 내림차순 → 실행액 → 건수 → 이름. 결정적 정렬.
    .sort(
      (a, b) =>
        b.feeSum - a.feeSum ||
        b.execSum - a.execSum ||
        b.dealCount - a.dealCount ||
        a.name.localeCompare(b.name, "ko"),
    );

  return {
    period,
    range,
    available: entries.length > 0,
    top: entries[0] ?? null,
    entries,
  };
}
