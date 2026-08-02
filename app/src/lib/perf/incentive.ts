// T07 · mod.perf 인센티브 규칙 평가(순수 함수, 설계 §2.3).
//
// I/O 없음. 규칙(incentive_rules.config_jsonb)은 사용자가 편집하는 jsonb 라
// **신뢰하지 않고 전부 검증**한다 — 깨진 설정이 NaN 금액으로 새어나가면
// 스냅샷·리더보드·지급액이 조용히 오염된다. 파싱 실패는 "인센티브 0" 이 아니라
// 명시적 오류로 올려 호출부가 판단하게 한다.
//
// 퍼센트 관례: settlements 와 동일하게 **정수 퍼센트**(3 = 3%, ÷100).

import type { IncentiveBase, IncentiveRule } from "@/lib/types";

/** 인센티브 기준액 3종 — settlements 집계 결과. */
export interface IncentiveBaseAmounts {
  /** 수수료 합 — settlements.fee_amount(001 generated, 이미 round). */
  feeSum: number;
  /** 계약금 합 — settlements.down_payment. */
  downSum: number;
  /** 총매출 합 — settlements.total_revenue(001 generated). */
  totalSum: number;
}

/** `tiered` 구간 1개. */
export interface IncentiveTier {
  /** 구간 하한(이상). 0 이상. */
  min: number;
  /** 해당 구간 요율(정수 %). */
  pct: number;
}

/** 구간 적용 방식. `whole`=달성구간 요율을 전체 금액에, `marginal`=누진. */
export type TieredMode = "whole" | "marginal";

/** 검증을 통과한 규칙 설정. */
export type IncentiveConfig =
  | { kind: "flat_pct"; pct: number }
  | { kind: "tiered"; mode: TieredMode; tiers: IncentiveTier[] };

/** 규칙 설정이 잘못됐을 때 — 호출부가 사용자에게 그대로 보여줄 수 있는 메시지. */
export class IncentiveConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncentiveConfigError";
  }
}

/** 기본 구간 모드 — 설계 §6-3 기본안. */
export const DEFAULT_TIERED_MODE: TieredMode = "whole";

/**
 * 원 단위 반올림.
 *
 * PostgreSQL `round(numeric)` 는 **half-away-from-zero** 인데 JS `Math.round` 는
 * half-up(음수에서 0 쪽으로)이라 음수에서 결과가 갈린다. 인센티브는 환수(음수)
 * 규칙이 생길 수 있으므로 DB 와 같은 규칙으로 맞춘다 — 두 계층이 다른 값을 내면
 * "앱은 -3원, DB 는 -2원" 같은 재현 불가능한 정산 불일치가 된다.
 */
export function roundWon(value: number): number {
  if (!Number.isFinite(value)) {
    throw new IncentiveConfigError("인센티브 계산 결과가 유한한 수가 아닙니다");
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** 유한한 수인지 확인하고 아니면 오류. */
function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new IncentiveConfigError(`${label}: 숫자가 필요합니다`);
  }
  return value;
}

/**
 * `config_jsonb` → 검증된 설정.
 *
 * @throws IncentiveConfigError 형식이 규칙 type 과 맞지 않으면.
 */
export function parseIncentiveConfig(rule: IncentiveRule): IncentiveConfig {
  const config = rule.config_jsonb ?? {};

  if (rule.type === "flat_pct") {
    const pct = requireFiniteNumber(config.pct, "고정% 규칙의 pct");
    return { kind: "flat_pct", pct };
  }

  // tiered
  const rawTiers = config.tiers;
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
    throw new IncentiveConfigError("구간% 규칙에는 tiers 배열이 1개 이상 필요합니다");
  }

  const tiers: IncentiveTier[] = rawTiers.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new IncentiveConfigError(`구간 ${i + 1}: 객체가 아닙니다`);
    }
    const t = raw as { min?: unknown; pct?: unknown };
    const min = requireFiniteNumber(t.min, `구간 ${i + 1}의 min`);
    const pct = requireFiniteNumber(t.pct, `구간 ${i + 1}의 pct`);
    if (min < 0) throw new IncentiveConfigError(`구간 ${i + 1}의 min 은 0 이상이어야 합니다`);
    return { min, pct };
  });

  // min 오름차순으로 정규화한다(설계는 오름차순을 가정하지만 편집 UI 가 순서를
  // 보장하지 않는다 — 여기서 한 번 세우면 아래 로직이 순서를 다시 걱정하지 않는다).
  tiers.sort((a, b) => a.min - b.min);

  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i].min === tiers[i - 1].min) {
      throw new IncentiveConfigError(`중복된 구간 경계: min=${tiers[i].min}`);
    }
  }

  const rawMode = config.mode;
  if (rawMode !== undefined && rawMode !== "whole" && rawMode !== "marginal") {
    throw new IncentiveConfigError(`알 수 없는 구간 모드: ${String(rawMode)}`);
  }

  return { kind: "tiered", mode: rawMode ?? DEFAULT_TIERED_MODE, tiers };
}

/** 규칙의 기준액을 고른다(설계 §2.3). */
export function pickBaseAmount(base: IncentiveBase, amounts: IncentiveBaseAmounts): number {
  if (base === "down") return amounts.downSum;
  if (base === "total") return amounts.totalSum;
  return amounts.feeSum;
}

/**
 * `whole` — 기준액이 속한 **최상위 구간**의 요율을 기준액 전체에 적용한다.
 * 어느 구간에도 못 미치면(최소 구간 min 미달) 요율 0.
 */
function evaluateWhole(baseAmount: number, tiers: readonly IncentiveTier[]): number {
  let pct = 0;
  for (const tier of tiers) {
    if (baseAmount >= tier.min) pct = tier.pct;
    else break; // min 오름차순이므로 여기서부터는 전부 미달.
  }
  return (baseAmount * pct) / 100;
}

/**
 * `marginal` — 각 구간 경계 사이 금액에 그 구간 요율을 적용해 합산(누진).
 *
 * 최소 구간의 min 미만 금액은 어느 구간에도 속하지 않으므로 요율 0이다
 * (min=0 구간을 두면 첫 원부터 적용된다).
 */
function evaluateMarginal(baseAmount: number, tiers: readonly IncentiveTier[]): number {
  let total = 0;
  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    if (baseAmount <= tier.min) break; // 이 구간에 도달하지 못했다.
    // 이 구간의 상한 = 다음 구간의 하한(없으면 무한).
    const upper = i + 1 < tiers.length ? tiers[i + 1].min : Number.POSITIVE_INFINITY;
    const slice = Math.min(baseAmount, upper) - tier.min;
    total += (slice * tier.pct) / 100;
  }
  return total;
}

/**
 * 규칙 1개를 기준액에 적용한다.
 *
 * 반올림은 **최종 1회만** 한다(설계 §2.3) — 구간별로 반올림하면 누진 합계가
 * 경계에서 미세하게 어긋난다.
 *
 * @throws IncentiveConfigError 설정이 잘못됐거나 결과가 유한하지 않으면.
 */
export function evaluateIncentive(
  rule: IncentiveRule,
  amounts: IncentiveBaseAmounts,
): number {
  const config = parseIncentiveConfig(rule);
  const baseAmount = pickBaseAmount(rule.base, amounts);

  const raw =
    config.kind === "flat_pct"
      ? (baseAmount * config.pct) / 100
      : config.mode === "whole"
        ? evaluateWhole(baseAmount, config.tiers)
        : evaluateMarginal(baseAmount, config.tiers);

  return roundWon(raw);
}

/**
 * 스냅샷 계산에 쓸 **활성 규칙 1개**를 고른다(설계 §2.3 · §6-2: MVP 는 조직당 1개).
 *
 * 우선순위: `config.active === true` 인 것 → 없으면 목록의 마지막(최근) 것.
 * 활성 규칙이 여럿이면 판정이 조용히 갈리므로 **오류**로 올린다 — 임의로 하나를
 * 고르면 이번 달과 다음 달의 인센티브가 이유 없이 달라진다.
 *
 * @returns 규칙이 하나도 없으면 null(인센티브 0으로 계산).
 * @throws IncentiveConfigError active 규칙이 2개 이상이면.
 */
export function resolveActiveRule(
  rules: readonly IncentiveRule[],
): IncentiveRule | null {
  if (rules.length === 0) return null;

  const active = rules.filter((r) => r.config_jsonb?.active === true);
  if (active.length > 1) {
    throw new IncentiveConfigError(
      `활성 인센티브 규칙이 ${active.length}개입니다 — 정확히 1개만 활성화하세요`,
    );
  }
  if (active.length === 1) return active[0];

  return rules[rules.length - 1];
}
