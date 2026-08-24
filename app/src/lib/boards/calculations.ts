export type CalculatedFieldKey =
  | "reapply_notice_date"
  | "fee_amount"
  | "total_revenue"
  | "review_dday"
  | "d180"
  | "read_count";

export interface CalculationInputs {
  executionAmount?: number | null;
  /**
   * ★ 2026-08-25 — `feePercent` 를 대신한다.
   *
   * 총괄 직접 지시로 계약업체 실무의 «수수료(%)» 가 «계약조건»(자유기재) 이 됐다.
   * 자유기재에서는 «실행액 × %» 를 뽑을 수 없다 — 그래서 근거를 바꾼다.
   * 수수료 «금액» 의 정본은 **원장**이다(`ledger.kind = 'fee'` 합계).
   * 목업 부제도 같은 말을 한다 — 「금액은 원장 합계」.
   *
   * ⚠ 이 값은 «못 읽었다» 와 «0원» 을 구분해야 한다. 못 읽었으면 null 을 넘긴다.
   *   0 을 넘기면 화면이 «수수료 0원» 이라고 단언해 버린다.
   */
  ledgerFeeTotal?: number | null;
  fundedOn?: string | null;
  feePaidOn?: string | null;
  reviewEndsOn?: string | null;
  targetIds?: readonly string[] | null;
  readerIds?: readonly string[] | null;
}

export interface CalculatedFieldResult {
  values: Record<CalculatedFieldKey, number | string | null>;
  calculatedAt: string;
  staleAfter: Partial<Record<CalculatedFieldKey, string>>;
}

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDay(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function nextKstMidnight(now: Date): string {
  const next = new Date(`${kstDay(now)}T15:00:00.000Z`);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function addDays(value: string | null | undefined, days: number): string | null {
  const date = parseIsoDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function reviewDday(value: string | null | undefined, now: Date): string | null {
  const end = parseIsoDate(value);
  const today = parseIsoDate(kstDay(now));
  if (!end || !today) return null;
  const days = Math.round((end.getTime() - today.getTime()) / DAY_MS);
  return days > 0 ? `D-${days}` : days === 0 ? "오늘" : "지남";
}

function feeAmount(ledgerFeeTotal?: number | null): number | null {
  // 원장을 못 읽었으면 «0원» 이 아니라 «모른다» 다. 그 둘을 섞으면 미수금이 조용히 사라진다.
  return Number.isFinite(ledgerFeeTotal) ? (ledgerFeeTotal as number) : null;
}

function readCount(targetIds?: readonly string[] | null, readerIds?: readonly string[] | null): number | null {
  if (!targetIds || !readerIds) return null;
  const readers = new Set(readerIds);
  return new Set(targetIds.filter((id) => readers.has(id))).size;
}

/** BBE-153/D79의 6개 공식을 한 건에 적용한다. 저장은 DB migration이 담당한다. */
export function calculateFields(
  input: CalculationInputs,
  now: Date = new Date(),
  boardFeeTotal?: number | null,
): CalculatedFieldResult {
  const fee = feeAmount(input.ledgerFeeTotal);
  const calculatedAt = now.toISOString();
  const staleAt = nextKstMidnight(now);

  return {
    values: {
      reapply_notice_date: addDays(input.fundedOn, 365),
      fee_amount: fee,
      total_revenue: Number.isFinite(boardFeeTotal) ? boardFeeTotal as number : null,
      review_dday: reviewDday(input.reviewEndsOn, now),
      d180: addDays(input.feePaidOn, 180),
      read_count: readCount(input.targetIds, input.readerIds),
    },
    calculatedAt,
    staleAfter: {
      review_dday: staleAt,
      d180: staleAt,
    },
  };
}

export function calculationFreshness(
  calculatedAt: string | null | undefined,
  staleAfter: string | null | undefined,
  latestSourceAt: string | null | undefined,
  latestFailureAt: string | null | undefined,
  now: Date = new Date(),
): "fresh" | "stale" | "unknown" {
  const calculated = calculatedAt ? Date.parse(calculatedAt) : NaN;
  if (!Number.isFinite(calculated)) return "unknown";
  const deadline = staleAfter ? Date.parse(staleAfter) : NaN;
  const source = latestSourceAt ? Date.parse(latestSourceAt) : NaN;
  const failure = latestFailureAt ? Date.parse(latestFailureAt) : NaN;
  if ((Number.isFinite(deadline) && deadline <= now.getTime())
    || (Number.isFinite(source) && source > calculated)
    || (Number.isFinite(failure) && failure > calculated)) {
    return "stale";
  }
  return "fresh";
}
