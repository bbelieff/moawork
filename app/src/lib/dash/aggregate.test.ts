import { describe, it, expect } from "vitest";
import type { Deal, FieldDef, Stage } from "@/lib/types";
import {
  contractStatusBreakdown,
  conversionRate,
  DEFAULT_SETTLEMENT_KEYS,
  filterDealsByRange,
  inRange,
  monthRangeKst,
  pipelineBreakdown,
  provisionalSettlementFromAmounts,
  ratio,
  reachedKind,
  settlementSummaryOrProvisional,
  reContactDue,
  reContactList,
  settlementSummary,
  sumAmounts,
  toDate,
  toNumber,
  toSettlementInputs,
} from "./aggregate";

// ── 픽스처 ───────────────────────────────────────────────

const stages: Stage[] = [
  { id: "s1", pipeline_id: "p1", name: "마케팅", sort_order: 0, kind: "marketing" },
  { id: "s2", pipeline_id: "p1", name: "미팅", sort_order: 1, kind: "meeting" },
  { id: "s3", pipeline_id: "p1", name: "계약", sort_order: 2, kind: "contract" },
  { id: "s4", pipeline_id: "p1", name: "실행", sort_order: 3, kind: "work" },
];

function deal(id: string, patch: Partial<Deal> = {}): Deal {
  return {
    id,
    org_id: "o1",
    company_id: null,
    pipeline_id: "p1",
    stage_id: null,
    assigned_to: null,
    title: `딜 ${id}`,
    amount: null,
    status_note: null,
    applied_on: null,
    custom: {},
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...patch,
  };
}

// ── ratio: 0분모 방어 ────────────────────────────────────

describe("ratio", () => {
  it("정상 비율을 계산한다", () => {
    expect(ratio(1, 4)).toBe(0.25);
  });

  it("분모가 0이면 0을 반환한다(NaN 금지)", () => {
    expect(ratio(0, 0)).toBe(0);
    expect(ratio(5, 0)).toBe(0);
  });

  it("분모가 음수/비유한이면 0을 반환한다", () => {
    expect(ratio(1, -3)).toBe(0);
    expect(ratio(1, Number.NaN)).toBe(0);
  });
});

// ── 월 경계(KST) ─────────────────────────────────────────

describe("monthRangeKst", () => {
  it("KST 월초/월말 경계를 UTC 반열린 구간으로 만든다", () => {
    // 2026-07-01 00:00 KST = 2026-06-30 15:00 UTC
    expect(monthRangeKst("2026-07")).toEqual({
      start: "2026-06-30T15:00:00.000Z",
      end: "2026-07-31T15:00:00.000Z",
    });
  });

  it("연말 경계를 넘긴다", () => {
    expect(monthRangeKst("2026-12")).toEqual({
      start: "2026-11-30T15:00:00.000Z",
      end: "2026-12-31T15:00:00.000Z",
    });
  });

  it("잘못된 형식은 예외", () => {
    expect(() => monthRangeKst("2026/07")).toThrow();
  });

  it("KST 월말 23:59 는 포함, 다음달 00:00 은 제외", () => {
    const r = monthRangeKst("2026-07");
    // 2026-07-31 23:59 KST = 2026-07-31T14:59Z → 포함
    expect(inRange("2026-07-31T14:59:00.000Z", r)).toBe(true);
    // 2026-08-01 00:00 KST = 2026-07-31T15:00Z → 제외(반열린)
    expect(inRange("2026-07-31T15:00:00.000Z", r)).toBe(false);
    // 2026-06-30 23:59 KST = 2026-06-30T14:59Z → 제외
    expect(inRange("2026-06-30T14:59:00.000Z", r)).toBe(false);
  });
});

describe("inRange", () => {
  const r = monthRangeKst("2026-07");
  it("null/빈값/파싱불가는 false", () => {
    expect(inRange(null, r)).toBe(false);
    expect(inRange(undefined, r)).toBe(false);
    expect(inRange("", r)).toBe(false);
    expect(inRange("헛소리", r)).toBe(false);
  });
});

describe("filterDealsByRange", () => {
  it("기본은 created_at 기준으로 거른다", () => {
    const ds = [
      deal("a", { created_at: "2026-07-10T00:00:00.000Z" }),
      deal("b", { created_at: "2026-08-10T00:00:00.000Z" }),
    ];
    const got = filterDealsByRange(ds, monthRangeKst("2026-07"));
    expect(got.map((d) => d.id)).toEqual(["a"]);
  });

  it("pick 으로 다른 날짜 필드를 쓸 수 있다", () => {
    const ds = [
      deal("a", { applied_on: "2026-07-05" }),
      deal("b", { applied_on: null }),
    ];
    const got = filterDealsByRange(ds, monthRangeKst("2026-07"), (d) => d.applied_on);
    expect(got.map((d) => d.id)).toEqual(["a"]);
  });
});

// ── 파이프라인 단계별 집계 ────────────────────────────────

describe("pipelineBreakdown", () => {
  it("단계별 건수와 비율을 계산하고 빈 단계도 포함한다", () => {
    const ds = [
      deal("a", { stage_id: "s1" }),
      deal("b", { stage_id: "s1" }),
      deal("c", { stage_id: "s3" }),
    ];
    const got = pipelineBreakdown(ds, stages);
    expect(got.total).toBe(3);
    expect(got.unassigned).toBe(0);
    expect(got.stages).toHaveLength(4);
    expect(got.stages.map((s) => s.count)).toEqual([2, 0, 1, 0]);
    expect(got.stages[0].ratio).toBeCloseTo(2 / 3);
    expect(got.stages[1].ratio).toBe(0);
  });

  it("sort_order 오름차순으로 정렬한다(입력 순서 무관)", () => {
    const shuffled = [stages[2], stages[0], stages[3], stages[1]];
    const got = pipelineBreakdown([], shuffled);
    expect(got.stages.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("단계 미지정/미지 단계는 unassigned 로 분리한다", () => {
    const ds = [
      deal("a", { stage_id: null }),
      deal("b", { stage_id: "없는단계" }),
      deal("c", { stage_id: "s2" }),
    ];
    const got = pipelineBreakdown(ds, stages);
    expect(got.unassigned).toBe(2);
    expect(got.stages.find((s) => s.stageId === "s2")?.count).toBe(1);
  });

  it("딜 0건이면 모든 값이 0(NaN 없음)", () => {
    const got = pipelineBreakdown([], stages);
    expect(got.total).toBe(0);
    expect(got.unassigned).toBe(0);
    expect(got.stages.every((s) => s.count === 0 && s.ratio === 0)).toBe(true);
  });

  it("단계 정의가 없으면 전부 unassigned", () => {
    const got = pipelineBreakdown([deal("a", { stage_id: "s1" })], []);
    expect(got.stages).toEqual([]);
    expect(got.unassigned).toBe(1);
  });
});

// ── 도달/전환율 ──────────────────────────────────────────

describe("reachedKind", () => {
  it("해당 kind 첫 단계 이상에 도달한 딜을 센다", () => {
    const ds = [
      deal("a", { stage_id: "s1" }), // marketing(0)
      deal("b", { stage_id: "s3" }), // contract(2)
      deal("c", { stage_id: "s4" }), // work(3) → contract 도달로 침
    ];
    expect(reachedKind(ds, stages, "contract")).toBe(2);
  });

  it("단계 미지정 딜은 도달로 세지 않는다", () => {
    expect(reachedKind([deal("a", { stage_id: null })], stages, "marketing")).toBe(0);
  });

  it("해당 kind 단계가 없으면 0", () => {
    expect(reachedKind([deal("a", { stage_id: "s4" })], stages, "post")).toBe(0);
  });
});

describe("conversionRate", () => {
  it("분모=전체 딜, 분자=도달 딜", () => {
    const ds = [
      deal("a", { stage_id: "s1" }),
      deal("b", { stage_id: "s3" }),
      deal("c", { stage_id: "s4" }),
      deal("d", { stage_id: null }),
    ];
    const got = conversionRate(ds, stages, "contract");
    expect(got).toEqual({ kind: "contract", reached: 2, total: 4, rate: 0.5 });
  });

  it("딜 0건이면 rate=0 (0분모 방어)", () => {
    expect(conversionRate([], stages, "contract")).toEqual({
      kind: "contract",
      reached: 0,
      total: 0,
      rate: 0,
    });
  });
});

// ── 금액 합계 ────────────────────────────────────────────

describe("sumAmounts", () => {
  it("null 금액은 0으로 취급해 합산한다", () => {
    expect(sumAmounts([deal("a", { amount: 100 }), deal("b", { amount: null })])).toBe(100);
  });

  it("빈 배열은 0", () => {
    expect(sumAmounts([])).toBe(0);
  });
});

// ── 계약상황 분포 ────────────────────────────────────────

const contractField: FieldDef = {
  id: "f1",
  org_id: "o1",
  entity: "deal",
  key: "계약상황",
  label: "계약상황",
  type: "select",
  options_jsonb: {
    options: [
      { id: "before", label: "계약 전" },
      { id: "written", label: "계약서 작성완료" },
      { id: "gone", label: "계약취소", archived: true },
    ],
  },
  module_key: "ind.policyfund",
  sort_order: 0,
};

describe("contractStatusBreakdown", () => {
  it("옵션 id 로 매칭해 분포를 만든다", () => {
    const ds = [
      deal("a", { custom: { 계약상황: "before" } }),
      deal("b", { custom: { 계약상황: "written" } }),
      deal("c", { custom: { 계약상황: "written" } }),
    ];
    const got = contractStatusBreakdown(ds, [contractField]);
    expect(got.available).toBe(true);
    expect(got.fieldKey).toBe("계약상황");
    expect(got.unset).toBe(0);
    expect(got.options.find((o) => o.optionId === "written")?.count).toBe(2);
    expect(got.options.find((o) => o.optionId === "written")?.ratio).toBeCloseTo(2 / 3);
  });

  it("라벨로도 매칭한다(폴백)", () => {
    const ds = [deal("a", { custom: { 계약상황: "계약 전" } })];
    const got = contractStatusBreakdown(ds, [contractField]);
    expect(got.options.find((o) => o.optionId === "before")?.count).toBe(1);
    expect(got.unset).toBe(0);
  });

  it("archived 옵션은 제외한다", () => {
    const got = contractStatusBreakdown([], [contractField]);
    expect(got.options.map((o) => o.optionId)).toEqual(["before", "written"]);
  });

  it("값이 없거나 모르는 값이면 unset 으로 센다", () => {
    const ds = [
      deal("a"),
      deal("b", { custom: { 계약상황: "이상한값" } }),
      deal("c", { custom: { 계약상황: 123 } }),
    ];
    const got = contractStatusBreakdown(ds, [contractField]);
    expect(got.unset).toBe(3);
  });

  it("필드 정의가 없으면 available=false (화면 '—')", () => {
    const got = contractStatusBreakdown([deal("a")], []);
    expect(got.available).toBe(false);
    expect(got.fieldKey).toBeNull();
    expect(got.unset).toBe(1);
  });

  it("company 엔티티의 동명 필드는 쓰지 않는다", () => {
    const companyField: FieldDef = { ...contractField, entity: "company" };
    expect(contractStatusBreakdown([deal("a")], [companyField]).available).toBe(false);
  });
});

// ── 값 강제 변환 ─────────────────────────────────────────

describe("toNumber", () => {
  it("숫자/숫자문자열/콤마·통화기호를 파싱한다", () => {
    expect(toNumber(1000)).toBe(1000);
    expect(toNumber("1,000")).toBe(1000);
    expect(toNumber("₩ 2,500")).toBe(2500);
  });

  it("빈값·비수치·비유한은 null", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
  });
});

describe("toDate", () => {
  it("날짜 문자열을 Date 로", () => {
    expect(toDate("2026-07-21")?.toISOString().slice(0, 10)).toBe("2026-07-21");
  });
  it("빈값·비문자·비날짜는 null", () => {
    expect(toDate("")).toBeNull();
    expect(toDate("헛소리")).toBeNull();
    expect(toDate(42)).toBeNull();
  });
});

// ── 정산 요약 (T09 확정 수식) ────────────────────────────

describe("toSettlementInputs", () => {
  it("실행액·수수료율이 모두 있는 딜만 대상으로 삼는다", () => {
    const ds = [
      deal("a", { custom: { 실행액: 100_000_000, 수수료율: 3, 계약금: 1_000_000 } }),
      deal("b", { custom: { 실행액: 100_000_000 } }), // 수수료율 없음 → 제외
      deal("c", { custom: {} }), // 제외
    ];
    const got = toSettlementInputs(ds);
    expect(got.map((g) => g.deal.id)).toEqual(["a"]);
    expect(got[0].input.downPayment).toBe(1_000_000);
  });

  it("계약금 누락은 0으로 보정한다", () => {
    const ds = [deal("a", { custom: { 실행액: 1000, 수수료율: 10 } })];
    expect(toSettlementInputs(ds)[0].input.downPayment).toBe(0);
  });

  it("수수료입금일이 없으면 null", () => {
    const ds = [deal("a", { custom: { 실행액: 1000, 수수료율: 10 } })];
    expect(toSettlementInputs(ds)[0].input.feeDepositDate).toBeNull();
  });

  it("키 맵을 주입할 수 있다", () => {
    const ds = [deal("a", { custom: { exec: 1000, rate: 5 } })];
    const got = toSettlementInputs(ds, {
      ...DEFAULT_SETTLEMENT_KEYS,
      disbursedAmount: "exec",
      feePercent: "rate",
    });
    expect(got).toHaveLength(1);
    expect(got[0].input.disbursedAmount).toBe(1000);
  });
});

describe("settlementSummary", () => {
  it("T09 확정 수식(수수료=실행액×%/100, 총매출=계약금+수수료)으로 합산한다", () => {
    const entries = toSettlementInputs([
      deal("a", { custom: { 실행액: 100_000_000, 수수료율: 3, 계약금: 1_000_000 } }),
      deal("b", { custom: { 실행액: 50_000_000, 수수료율: 2, 계약금: 500_000 } }),
    ]);
    const got = settlementSummary(entries);
    expect(got.available).toBe(true);
    expect(got.count).toBe(2);
    expect(got.downPaymentSum).toBe(1_500_000);
    // 3,000,000 + 1,000,000
    expect(got.feeSum).toBe(4_000_000);
    expect(got.totalRevenueSum).toBe(1_500_000 + 4_000_000);
  });

  it("입력이 없으면 available=false 이고 합계는 0", () => {
    expect(settlementSummary([])).toEqual({
      available: false,
      provisional: false,
      count: 0,
      downPaymentSum: 0,
      feeSum: 0,
      totalRevenueSum: 0,
    });
  });

  it("정확 계산은 provisional=false 로 표시한다", () => {
    const entries = toSettlementInputs([
      deal("a", { custom: { 실행액: 1000, 수수료율: 10 } }),
    ]);
    expect(settlementSummary(entries).provisional).toBe(false);
  });
});

// ── 정산 임시 추정 (기획2 피드백: '—' 대신 amount 기반) ──

describe("provisionalSettlementFromAmounts", () => {
  it("deal.amount 합계를 총매출 근사로 쓰고 provisional=true", () => {
    const got = provisionalSettlementFromAmounts([
      deal("a", { amount: 1_000_000 }),
      deal("b", { amount: 500_000 }),
    ]);
    expect(got.available).toBe(true);
    expect(got.provisional).toBe(true);
    expect(got.count).toBe(2);
    expect(got.totalRevenueSum).toBe(1_500_000);
    // 수수료·계약금은 산출 불가 → 0
    expect(got.feeSum).toBe(0);
    expect(got.downPaymentSum).toBe(0);
  });

  it("amount 가 있는 딜만 센다", () => {
    const got = provisionalSettlementFromAmounts([
      deal("a", { amount: 100 }),
      deal("b", { amount: null }),
    ]);
    expect(got.count).toBe(1);
    expect(got.totalRevenueSum).toBe(100);
  });

  it("amount 가 하나도 없으면 available=false", () => {
    const got = provisionalSettlementFromAmounts([deal("a", { amount: null })]);
    expect(got.available).toBe(false);
    expect(got.provisional).toBe(true);
  });
});

describe("settlementSummaryOrProvisional", () => {
  it("정산 원천이 있으면 실측을 쓴다(폴백 안 함)", () => {
    const entries = toSettlementInputs([
      deal("a", { custom: { 실행액: 100_000_000, 수수료율: 3, 계약금: 1_000_000 } }),
    ]);
    const got = settlementSummaryOrProvisional(entries, [deal("z", { amount: 999 })]);
    expect(got.provisional).toBe(false);
    expect(got.feeSum).toBe(3_000_000);
  });

  it("정산 원천이 없으면 amount 기반 임시로 폴백한다", () => {
    const got = settlementSummaryOrProvisional([], [deal("z", { amount: 999 })]);
    expect(got.provisional).toBe(true);
    expect(got.totalRevenueSum).toBe(999);
  });

  it("둘 다 없으면 available=false", () => {
    expect(settlementSummaryOrProvisional([], []).available).toBe(false);
  });
});

// ── 재접촉 (D+180 / D+365) ───────────────────────────────

describe("reContactList", () => {
  it("수수료입금일 기준 D+180/D+365 를 만든다", () => {
    const entries = toSettlementInputs([
      deal("a", {
        custom: { 실행액: 1000, 수수료율: 10, 수수료입금일: "2026-01-01" },
      }),
    ]);
    const got = reContactList(entries);
    expect(got).toHaveLength(1);
    expect(got[0].dPlus180).toBe("2026-06-30");
    expect(got[0].dPlus365).toBe("2027-01-01");
  });

  it("수수료입금일이 없으면 기본 제외, includeUndated 면 포함(D+n=null)", () => {
    const entries = toSettlementInputs([deal("a", { custom: { 실행액: 1000, 수수료율: 10 } })]);
    expect(reContactList(entries)).toHaveLength(0);
    const inc = reContactList(entries, true);
    expect(inc).toHaveLength(1);
    expect(inc[0].dPlus180).toBeNull();
  });
});

describe("reContactDue", () => {
  it("지정 월 구간에 드는 재접촉 건만 남긴다", () => {
    const entries = toSettlementInputs([
      deal("a", { custom: { 실행액: 1, 수수료율: 1, 수수료입금일: "2026-01-01" } }), // D+180=2026-06-30
      deal("b", { custom: { 실행액: 1, 수수료율: 1, 수수료입금일: "2026-01-25" } }), // D+180=2026-07-24
    ]);
    const list = reContactList(entries);
    const due = reContactDue(list, monthRangeKst("2026-07"));
    expect(due.map((d) => d.dealId)).toEqual(["b"]);
  });

  it("dPlus365 기준으로도 거를 수 있다", () => {
    const entries = toSettlementInputs([
      deal("a", { custom: { 실행액: 1, 수수료율: 1, 수수료입금일: "2026-01-01" } }), // D+365=2027-01-01
    ]);
    const list = reContactList(entries);
    expect(reContactDue(list, monthRangeKst("2027-01"), "dPlus365")).toHaveLength(1);
    expect(reContactDue(list, monthRangeKst("2026-07"), "dPlus365")).toHaveLength(0);
  });
});
