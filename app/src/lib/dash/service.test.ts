import { describe, it, expect } from "vitest";
import type { Company, Ctx, Deal, FieldDef, Pipeline, Stage } from "@/lib/types";
import type { Repo } from "@/lib/repo";
import { buildDashboard, buildFollowUps, currentMonthKst } from "./service";

// ── 가짜 Repo (buildDashboard 가 쓰는 메서드만 구현) ──────────

const stages: Stage[] = [
  { id: "s1", pipeline_id: "p1", name: "마케팅", sort_order: 0, kind: "marketing" },
  { id: "s2", pipeline_id: "p1", name: "미팅", sort_order: 1, kind: "meeting" },
  { id: "s3", pipeline_id: "p1", name: "계약", sort_order: 2, kind: "contract" },
  { id: "s4", pipeline_id: "p1", name: "정산", sort_order: 3, kind: "settle" },
];

const pipelines: Pipeline[] = [{ id: "p1", org_id: "o1", name: "기본 파이프라인" }];

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
    fee_terms: null,
    applied_on: null,
    custom: {},
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...patch,
  };
}

function fakeRepo(input: {
  deals?: Deal[];
  companies?: Company[];
  fieldDefs?: FieldDef[];
}): Repo {
  const stub = {
    listDeals: () => input.deals ?? [],
    listCompanies: () => input.companies ?? [],
    listPipelines: () => pipelines,
    listStages: (pipelineId: string) => stages.filter((s) => s.pipeline_id === pipelineId),
    listFieldDefs: () => input.fieldDefs ?? [],
  };
  return stub as unknown as Repo;
}

const ctx = {
  user: { id: "u1", email: null, name: null, avatar_url: null, created_at: "" },
  org: { id: "o1", name: "테스트", plan_tier: "t1_3", created_at: "" },
  role: "owner",
  scope: "all",
} as Ctx;

// ── currentMonthKst ──────────────────────────────────────

describe("currentMonthKst", () => {
  it("KST 기준 현재 월을 만든다", () => {
    // 2026-07-31 15:30 UTC = 2026-08-01 00:30 KST → 8월
    expect(currentMonthKst(new Date("2026-07-31T15:30:00Z"))).toBe("2026-08");
    // 2026-07-31 14:30 UTC = 2026-07-31 23:30 KST → 7월
    expect(currentMonthKst(new Date("2026-07-31T14:30:00Z"))).toBe("2026-07");
  });
});

// ── buildDashboard ───────────────────────────────────────

describe("buildDashboard", () => {
  it("데이터가 없으면 모든 수치가 0이고 정산은 available=false", () => {
    const got = buildDashboard(ctx, { repo: fakeRepo({}), month: "2026-07" });
    expect(got.totalDeals).toBe(0);
    expect(got.totalCompanies).toBe(0);
    expect(got.newDealsThisMonth).toBe(0);
    expect(got.amountSum).toBe(0);
    expect(got.pipeline.total).toBe(0);
    expect(got.settlementAll.available).toBe(false);
    expect(got.settlementThisMonth.available).toBe(false);
    expect(got.reContactThisMonth).toEqual([]);
    expect(got.conversions.every((c) => c.rate === 0)).toBe(true);
  });

  it("단계별 현황과 전환율을 파생한다", () => {
    const repo = fakeRepo({
      deals: [
        deal("a", { stage_id: "s1" }),
        deal("b", { stage_id: "s3" }),
        deal("c", { stage_id: "s4" }),
        deal("d", { stage_id: null }),
      ],
    });
    const got = buildDashboard(ctx, { repo, month: "2026-07" });
    expect(got.pipeline.total).toBe(4);
    expect(got.pipeline.unassigned).toBe(1);
    expect(got.pipeline.stages.map((s) => s.count)).toEqual([1, 0, 1, 1]);

    const contract = got.conversions.find((c) => c.kind === "contract");
    expect(contract).toEqual({ kind: "contract", reached: 2, total: 4, rate: 0.5 });
  });

  it("이번달 신규 딜을 KST 월 경계로 센다", () => {
    const repo = fakeRepo({
      deals: [
        deal("a", { created_at: "2026-07-10T00:00:00.000Z" }),
        // 2026-08-01 00:30 KST → 8월(제외)
        deal("b", { created_at: "2026-07-31T15:30:00.000Z" }),
        // 2026-07-31 23:30 KST → 7월(포함)
        deal("c", { created_at: "2026-07-31T14:30:00.000Z" }),
      ],
    });
    const got = buildDashboard(ctx, { repo, month: "2026-07" });
    expect(got.newDealsThisMonth).toBe(2);
  });

  it("정산은 전체와 '이번달 수납'(수수료입금일 기준)을 구분한다", () => {
    const repo = fakeRepo({
      deals: [
        deal("a", {
          custom: { exec_amount: 100_000_000, fee_pct: 3, down_payment: 1_000_000, fee_paid_at: "2026-07-15" },
        }),
        deal("b", {
          custom: { exec_amount: 50_000_000, fee_pct: 2, down_payment: 500_000, fee_paid_at: "2026-05-02" },
        }),
      ],
    });
    const got = buildDashboard(ctx, { repo, month: "2026-07" });

    // 전체: 수수료 3,000,000 + 1,000,000
    expect(got.settlementAll.count).toBe(2);
    expect(got.settlementAll.feeSum).toBe(4_000_000);

    // 이번달 수납: 7월 입금건(a)만
    expect(got.settlementThisMonth.count).toBe(1);
    expect(got.settlementThisMonth.feeSum).toBe(3_000_000);
    expect(got.settlementThisMonth.totalRevenueSum).toBe(1_000_000 + 3_000_000);
  });

  it("이번달 재접촉(D+180) 대상을 뽑는다", () => {
    const repo = fakeRepo({
      deals: [
        // D+180 = 2026-07-24 → 7월 대상
        deal("a", { custom: { exec_amount: 1, fee_pct: 1, fee_paid_at: "2026-01-25" } }),
        // D+180 = 2026-06-30 → 제외
        deal("b", { custom: { exec_amount: 1, fee_pct: 1, fee_paid_at: "2026-01-01" } }),
      ],
    });
    const got = buildDashboard(ctx, { repo, month: "2026-07" });
    expect(got.reContactThisMonth.map((r) => r.dealId)).toEqual(["a"]);
  });

  it("정산 원천이 없으면 deal.amount 기반 임시 추정으로 폴백한다(‘—’ 대신)", () => {
    const repo = fakeRepo({
      deals: [
        deal("a", { amount: 3_000_000, created_at: "2026-07-10T00:00:00.000Z" }),
        deal("b", { amount: 2_000_000, created_at: "2026-05-10T00:00:00.000Z" }),
      ],
    });
    const got = buildDashboard(ctx, { repo, month: "2026-07" });

    expect(got.settlementAll.provisional).toBe(true);
    expect(got.settlementAll.totalRevenueSum).toBe(5_000_000);
    // 임시 추정의 '이번달'은 생성일 기준(수수료입금일을 알 수 없음)
    expect(got.settlementThisMonth.provisional).toBe(true);
    expect(got.settlementThisMonth.totalRevenueSum).toBe(3_000_000);
    // 수수료·계약금은 산출 불가
    expect(got.settlementAll.feeSum).toBe(0);
  });

  it("정산 원천이 있으면 임시가 아니라 실측을 쓴다", () => {
    const repo = fakeRepo({
      deals: [
        deal("a", {
          amount: 999,
          custom: { exec_amount: 100_000_000, fee_pct: 3, down_payment: 1_000_000 },
        }),
      ],
    });
    const got = buildDashboard(ctx, { repo, month: "2026-07" });
    expect(got.settlementAll.provisional).toBe(false);
    expect(got.settlementAll.feeSum).toBe(3_000_000);
  });

  it("계약상황 필드가 없으면 available=false 로 내려준다", () => {
    const got = buildDashboard(ctx, { repo: fakeRepo({ deals: [deal("a")] }), month: "2026-07" });
    expect(got.contractStatus.available).toBe(false);
  });

  it("month 미지정 시 now 기준 KST 현재월을 쓴다", () => {
    const got = buildDashboard(ctx, {
      repo: fakeRepo({}),
      now: () => new Date("2026-03-05T00:00:00Z"),
    });
    expect(got.month).toBe("2026-03");
  });
});

// ── buildFollowUps (BBE-18 · 오늘 할 일) ──────────────────

describe("buildFollowUps", () => {
  const now = () => new Date("2026-07-24T02:00:00Z"); // 2026-07-24 11:00 KST

  it("데이터가 없으면 오늘·내일 전부 빈 배열", () => {
    const got = buildFollowUps(ctx, { repo: fakeRepo({}), now });
    expect(got.today).toBe("2026-07-24");
    expect(got.tomorrow).toBe("2026-07-25");
    expect(got.dueToday).toEqual([]);
    expect(got.dueTomorrow).toEqual([]);
  });

  it("오늘 도래하는 재접촉(D+180)을 오늘 할 일에 담는다", () => {
    const repo = fakeRepo({
      // fee_paid_at 2026-01-25 + 180일 = 2026-07-24(오늘)
      deals: [deal("a", { title: "재접촉 대상", custom: { exec_amount: 1, fee_pct: 1, fee_paid_at: "2026-01-25" } })],
    });
    const got = buildFollowUps(ctx, { repo, now });
    expect(got.dueToday).toEqual([
      { dealId: "a", title: "재접촉 대상", kind: "reContact", dueDate: "2026-07-24" },
    ]);
    expect(got.dueTomorrow).toEqual([]);
  });

  it("내일 도래하는 건은 dueTomorrow 에만 담긴다", () => {
    const repo = fakeRepo({
      // + 180일 = 2026-07-25(내일)
      deals: [deal("a", { custom: { exec_amount: 1, fee_pct: 1, fee_paid_at: "2026-01-26" } })],
    });
    const got = buildFollowUps(ctx, { repo, now });
    expect(got.dueToday).toEqual([]);
    expect(got.dueTomorrow).toHaveLength(1);
  });

  it("담당범위(ctx) 는 repo.listDeals 에 위임한다 — 여기서 이름을 고정하지 않는다(D26)", () => {
    let seenCtx: Ctx | null = null;
    const repo: Repo = {
      ...fakeRepo({}),
      listDeals: (c: Ctx) => {
        seenCtx = c;
        return [];
      },
    } as unknown as Repo;
    buildFollowUps(ctx, { repo, now });
    expect(seenCtx).toBe(ctx);
  });
});
