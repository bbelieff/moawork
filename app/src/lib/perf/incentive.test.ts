import { describe, expect, it } from "vitest";
import type { IncentiveRule } from "@/lib/types";
import {
  DEFAULT_TIERED_MODE,
  IncentiveConfigError,
  evaluateIncentive,
  parseIncentiveConfig,
  pickBaseAmount,
  resolveActiveRule,
  roundWon,
} from "./incentive";

function rule(patch: Partial<IncentiveRule> = {}): IncentiveRule {
  return {
    id: "r1",
    org_id: "o1",
    name: "기본 규칙",
    base: "fee",
    type: "flat_pct",
    config_jsonb: { pct: 10 },
    ...patch,
  };
}

const AMOUNTS = { feeSum: 1_000_000, downSum: 400_000, totalSum: 1_400_000 };

describe("roundWon", () => {
  it("0.5 는 0에서 먼 쪽으로 반올림한다 (PostgreSQL round 와 동일)", () => {
    expect(roundWon(2.5)).toBe(3);
    // Math.round(-2.5) 는 -2 다 — DB 와 어긋나므로 -3 이어야 한다.
    expect(roundWon(-2.5)).toBe(-3);
  });

  it("유한하지 않은 값은 오류", () => {
    expect(() => roundWon(Number.NaN)).toThrow(IncentiveConfigError);
    expect(() => roundWon(Number.POSITIVE_INFINITY)).toThrow(IncentiveConfigError);
  });
});

describe("pickBaseAmount", () => {
  it("base 별로 기준액을 고른다", () => {
    expect(pickBaseAmount("fee", AMOUNTS)).toBe(1_000_000);
    expect(pickBaseAmount("down", AMOUNTS)).toBe(400_000);
    expect(pickBaseAmount("total", AMOUNTS)).toBe(1_400_000);
  });
});

describe("parseIncentiveConfig", () => {
  it("flat_pct 는 pct 가 숫자여야 한다", () => {
    expect(parseIncentiveConfig(rule())).toEqual({ kind: "flat_pct", pct: 10 });
    expect(() => parseIncentiveConfig(rule({ config_jsonb: {} }))).toThrow(
      IncentiveConfigError,
    );
    expect(() =>
      parseIncentiveConfig(rule({ config_jsonb: { pct: "10" } })),
    ).toThrow(/숫자가 필요합니다/);
  });

  it("tiered 는 구간을 min 오름차순으로 정규화한다", () => {
    const parsed = parseIncentiveConfig(
      rule({
        type: "tiered",
        config_jsonb: {
          tiers: [
            { min: 1_000_000, pct: 5 },
            { min: 0, pct: 3 },
          ],
        },
      }),
    );
    expect(parsed).toEqual({
      kind: "tiered",
      mode: DEFAULT_TIERED_MODE,
      tiers: [
        { min: 0, pct: 3 },
        { min: 1_000_000, pct: 5 },
      ],
    });
  });

  it("빈 tiers · 중복 경계 · 알 수 없는 모드는 오류", () => {
    expect(() =>
      parseIncentiveConfig(rule({ type: "tiered", config_jsonb: { tiers: [] } })),
    ).toThrow(/1개 이상/);

    expect(() =>
      parseIncentiveConfig(
        rule({
          type: "tiered",
          config_jsonb: {
            tiers: [
              { min: 100, pct: 3 },
              { min: 100, pct: 5 },
            ],
          },
        }),
      ),
    ).toThrow(/중복된 구간 경계/);

    expect(() =>
      parseIncentiveConfig(
        rule({
          type: "tiered",
          config_jsonb: { mode: "progressive", tiers: [{ min: 0, pct: 3 }] },
        }),
      ),
    ).toThrow(/알 수 없는 구간 모드/);
  });
});

describe("evaluateIncentive · flat_pct", () => {
  it("기준액 × 정수퍼센트 / 100", () => {
    expect(evaluateIncentive(rule({ config_jsonb: { pct: 10 } }), AMOUNTS)).toBe(
      100_000,
    );
  });

  it("base=total 이면 총매출에 적용한다", () => {
    expect(
      evaluateIncentive(rule({ base: "total", config_jsonb: { pct: 5 } }), AMOUNTS),
    ).toBe(70_000);
  });

  it("최종 1회만 반올림한다", () => {
    // 333,333 × 3% = 9,999.99 → 10,000
    expect(
      evaluateIncentive(rule({ config_jsonb: { pct: 3 } }), {
        feeSum: 333_333,
        downSum: 0,
        totalSum: 0,
      }),
    ).toBe(10_000);
  });
});

describe("evaluateIncentive · tiered whole", () => {
  const whole = rule({
    type: "tiered",
    config_jsonb: {
      mode: "whole",
      tiers: [
        { min: 0, pct: 3 },
        { min: 1_000_000, pct: 5 },
        { min: 5_000_000, pct: 10 },
      ],
    },
  });

  it("달성 구간 요율을 기준액 **전체**에 적용한다", () => {
    // 1,000,000 은 두 번째 구간(5%) → 전체에 5%
    expect(evaluateIncentive(whole, AMOUNTS)).toBe(50_000);
  });

  it("경계 바로 아래는 하위 구간 요율", () => {
    expect(
      evaluateIncentive(whole, { feeSum: 999_999, downSum: 0, totalSum: 0 }),
    ).toBe(30_000); // 999,999 × 3% = 29,999.97 → 30,000
  });

  it("최소 구간 min 미만이면 0", () => {
    const gated = rule({
      type: "tiered",
      config_jsonb: { mode: "whole", tiers: [{ min: 1_000_000, pct: 5 }] },
    });
    expect(
      evaluateIncentive(gated, { feeSum: 999_999, downSum: 0, totalSum: 0 }),
    ).toBe(0);
  });
});

describe("evaluateIncentive · tiered marginal", () => {
  const marginal = rule({
    type: "tiered",
    config_jsonb: {
      mode: "marginal",
      tiers: [
        { min: 0, pct: 3 },
        { min: 1_000_000, pct: 5 },
        { min: 5_000_000, pct: 10 },
      ],
    },
  });

  it("구간별 해당액에만 그 요율을 적용해 합산한다", () => {
    // 6,000,000 → 0~1M×3% (30,000) + 1M~5M×5% (200,000) + 5M~6M×10% (100,000)
    expect(
      evaluateIncentive(marginal, { feeSum: 6_000_000, downSum: 0, totalSum: 0 }),
    ).toBe(330_000);
  });

  it("첫 구간 안에서는 whole 과 같은 값", () => {
    expect(
      evaluateIncentive(marginal, { feeSum: 500_000, downSum: 0, totalSum: 0 }),
    ).toBe(15_000);
  });

  it("경계값 정확히에서 다음 구간 몫은 0", () => {
    // 1,000,000 → 0~1M 구간만 = 30,000
    expect(evaluateIncentive(marginal, AMOUNTS)).toBe(30_000);
  });

  it("기준액 0 이면 0", () => {
    expect(
      evaluateIncentive(marginal, { feeSum: 0, downSum: 0, totalSum: 0 }),
    ).toBe(0);
  });
});

describe("resolveActiveRule", () => {
  it("규칙이 없으면 null", () => {
    expect(resolveActiveRule([])).toBeNull();
  });

  it("config.active=true 인 규칙을 고른다", () => {
    const a = rule({ id: "a" });
    const b = rule({ id: "b", config_jsonb: { pct: 5, active: true } });
    const c = rule({ id: "c" });
    expect(resolveActiveRule([a, b, c])?.id).toBe("b");
  });

  it("active 표시가 없으면 마지막(최근) 규칙", () => {
    expect(resolveActiveRule([rule({ id: "a" }), rule({ id: "b" })])?.id).toBe("b");
  });

  it("active 규칙이 2개 이상이면 오류 — 임의 선택 금지", () => {
    const a = rule({ id: "a", config_jsonb: { pct: 3, active: true } });
    const b = rule({ id: "b", config_jsonb: { pct: 5, active: true } });
    expect(() => resolveActiveRule([a, b])).toThrow(/정확히 1개만/);
  });
});
