// T07 · mod.perf 월 스냅샷 재계산(순수 함수, 설계 §2.4).
//
// 스냅샷은 **원장이 아니라 캐시**다 — 같은 소스로 다시 돌리면 반드시 같은 행이 나와야
// 하고(멱등), 재계산 결과가 항상 기존 저장값을 이긴다. 그래야 월 마감 배치를 몇 번
// 돌려도 지급액이 흔들리지 않는다.
//
// I/O 없음. 소스 조회(담당범위 적용)와 저장은 호출부(service.ts)가 맡는다.

import { inRange, monthRangeKst } from "@/lib/dash/aggregate";
import type { Deal, IncentiveRule, Settlement } from "@/lib/types";
import {
  type IncentiveBaseAmounts,
  evaluateIncentive,
} from "./incentive";

/**
 * 저장 직전의 스냅샷 1행 — `performance_snapshots` 의 쓰기 가능 컬럼만.
 * id·org_id 는 저장 계층이 채운다.
 */
export interface SnapshotRow {
  /** 귀속 조직원. 담당자 없는 정산을 모은 '조직 공통' 버킷은 null. */
  user_id: string | null;
  period: string;
  contracts_cnt: number;
  fee_sum: number;
  incentive_amount: number;
}

/** 사용자 1인의 기준액 누적기(인센티브 계산용). */
interface Accumulator extends IncentiveBaseAmounts {
  contractsCnt: number;
}

function emptyAccumulator(): Accumulator {
  return { contractsCnt: 0, feeSum: 0, downSum: 0, totalSum: 0 };
}

function accumulate(acc: Accumulator, s: Settlement): void {
  acc.contractsCnt += 1;
  // fee_amount·total_revenue 는 001 generated column(이미 round) — 재반올림하지 않는다.
  acc.feeSum += s.fee_amount;
  acc.downSum += s.down_payment;
  acc.totalSum += s.total_revenue;
}

/** 미배정 버킷의 정렬 키 — 항상 마지막에 오도록. */
const UNASSIGNED_SORT_KEY = "￿";

/**
 * 월 스냅샷 행을 만든다.
 *
 * 귀속(설계 §2.1): `settlement.fee_paid_at` 이 기준월인 정산만 대상이며
 * (`fee_paid_at` 이 null = 미실현 → 제외), `settlement.deal_id → deal.assigned_to` 로
 * 담당자에 귀속한다. 딜이 없거나 담당자가 없으면 `user_id=null` 버킷으로 모은다.
 *
 * 인센티브: 미배정 버킷은 **지급 대상자가 없으므로 항상 0** 이다. 규칙을 적용하면
 * 아무도 받지 않는 금액이 조직 합계에 잡혀 지급 예산이 부풀려진다.
 *
 * @param settlements 조직 전체 정산(담당범위 필터가 걸리지 않은 것 — 호출부 책임)
 * @param deals       귀속 조인용 딜
 * @param period      기준 월 'YYYY-MM' (KST)
 * @param rule        활성 인센티브 규칙. null 이면 인센티브 0.
 * @returns user_id 오름차순(미배정은 마지막)으로 정렬된 결정적 목록.
 * @throws IncentiveConfigError 규칙 설정이 잘못됐으면.
 */
export function buildSnapshotRows(
  settlements: readonly Settlement[],
  deals: readonly Deal[],
  period: string,
  rule: IncentiveRule | null,
): SnapshotRow[] {
  const range = monthRangeKst(period);
  const dealById = new Map(deals.map((d) => [d.id, d]));

  const byUser = new Map<string, Accumulator>();
  const unassigned = emptyAccumulator();
  let hasUnassigned = false;

  for (const s of settlements) {
    if (!inRange(s.fee_paid_at, range)) continue; // 미실현 또는 타월.

    const deal = s.deal_id ? dealById.get(s.deal_id) : undefined;
    const userId = deal?.assigned_to ?? null;

    if (userId === null) {
      accumulate(unassigned, s);
      hasUnassigned = true;
      continue;
    }

    let acc = byUser.get(userId);
    if (!acc) {
      acc = emptyAccumulator();
      byUser.set(userId, acc);
    }
    accumulate(acc, s);
  }

  const rows: SnapshotRow[] = [...byUser.entries()].map(([userId, acc]) => ({
    user_id: userId,
    period,
    contracts_cnt: acc.contractsCnt,
    fee_sum: acc.feeSum,
    incentive_amount: rule ? evaluateIncentive(rule, acc) : 0,
  }));

  if (hasUnassigned) {
    rows.push({
      user_id: null,
      period,
      contracts_cnt: unassigned.contractsCnt,
      fee_sum: unassigned.feeSum,
      incentive_amount: 0, // 지급 대상자 없음.
    });
  }

  // 결정적 정렬 — 같은 입력이면 저장 순서까지 같아야 멱등성을 눈으로 확인할 수 있다.
  rows.sort((a, b) =>
    (a.user_id ?? UNASSIGNED_SORT_KEY).localeCompare(b.user_id ?? UNASSIGNED_SORT_KEY),
  );

  return rows;
}

/**
 * 재계산 대상 월 — 배치가 "전월"을 확정할 때 쓴다(설계 §2.4-b).
 *
 * 기준 시각의 **KST** 연-월에서 한 달을 뺀다. UTC 로 계산하면 매월 1일 0시~9시
 * 사이에 한 달이 더 밀린다(KST=UTC+9).
 */
export function previousMonthKst(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth(); // 0-based → 그대로 쓰면 이미 '전월'
  const d = new Date(Date.UTC(year, month - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
