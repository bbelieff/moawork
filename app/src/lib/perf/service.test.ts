import { describe, it, expect } from "vitest";
import type { Repo } from "@/lib/repo";
import type { Company, Ctx, Deal, OrgMember, Settlement, User } from "@/lib/types";
import { buildPerf, getLeaderboard, getMonthlyContractCompanies } from "./service";

// ── 가짜 Repo (perf 서비스가 쓰는 메서드만 구현) ──────────────

function fakeRepo(input: {
  settlements?: Settlement[];
  deals?: Deal[];
  companies?: Company[];
  members?: Array<OrgMember & { user: User | undefined }>;
}): Repo {
  const stub = {
    listSettlements: () => input.settlements ?? [],
    listDeals: () => input.deals ?? [],
    listCompanies: () => input.companies ?? [],
    listMembers: () => input.members ?? [],
  };
  return stub as unknown as Repo;
}

function member(id: string, name: string): OrgMember & { user: User } {
  return {
    org_id: "o1",
    user_id: id,
    role: "member",
    scope: "all",
    created_at: "2026-01-01T00:00:00.000Z",
    user: {
      id,
      email: `${id}@example.com`,
      name,
      avatar_url: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

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
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

function settlement(
  id: string,
  dealId: string | null,
  execAmount: number,
  feePct: number,
  feePaidAt: string | null,
): Settlement {
  const feeAmount = Math.round((execAmount * feePct) / 100);
  return {
    id,
    org_id: "o1",
    deal_id: dealId,
    down_payment: 0,
    down_paid_at: null,
    exec_amount: execAmount,
    fee_pct: feePct,
    fee_paid_at: feePaidAt,
    fee_amount: feeAmount,
    total_revenue: feeAmount,
    d180: null,
    d365: null,
    created_at: "2026-07-01T00:00:00.000Z",
  };
}

const ctx = {
  user: { id: "u1", email: null, name: null, avatar_url: null, created_at: "" },
  org: { id: "o1", name: "테스트", plan_tier: "t1_3", created_at: "" },
  role: "owner",
  scope: "all",
} as Ctx;

// ── 테스트 ────────────────────────────────────────────────

describe("getLeaderboard", () => {
  it("데이터가 없으면 빈 리더보드와 0 합계를 낸다", () => {
    const lb = getLeaderboard(ctx, { repo: fakeRepo({}), period: "2026-07" });
    expect(lb.rows).toEqual([]);
    expect(lb.unassigned).toBeNull();
    expect(lb.totals).toEqual({ dealCount: 0, execSum: 0, feeSum: 0 });
  });

  it("Repo 조회 결과로 담당자별 실적을 조립한다", () => {
    const repo = fakeRepo({
      deals: [deal("d1", { assigned_to: "u1" }), deal("d2", { assigned_to: "u2" })],
      settlements: [
        settlement("s1", "d1", 1_000_000, 3, "2026-07-05"),
        settlement("s2", "d2", 5_000_000, 3, "2026-07-06"),
      ],
      members: [member("u1", "김영업"), member("u2", "이영업")],
    });
    const lb = getLeaderboard(ctx, { repo, period: "2026-07" });

    expect(lb.rows.map((r) => r.name)).toEqual(["이영업", "김영업"]);
    expect(lb.rows[0].feeSum).toBe(150_000);
    expect(lb.totals.dealCount).toBe(2);
  });

  it("period 미지정 시 now 주입값의 KST 현재월을 쓴다", () => {
    const repo = fakeRepo({
      deals: [deal("d1", { assigned_to: "u1" })],
      settlements: [settlement("s1", "d1", 1_000_000, 3, "2026-08-05")],
      members: [member("u1", "김영업")],
    });
    // 2026-07-31 15:30 UTC = 2026-08-01 00:30 KST → 8월
    const lb = getLeaderboard(ctx, {
      repo,
      now: () => new Date("2026-07-31T15:30:00Z"),
    });
    expect(lb.period).toBe("2026-08");
    expect(lb.totals.dealCount).toBe(1);
  });

  it("정렬 기준을 전달하면 리더보드에 반영된다", () => {
    const repo = fakeRepo({
      deals: [deal("d1", { assigned_to: "u1" }), deal("d2", { assigned_to: "u2" })],
      settlements: [
        settlement("s1", "d1", 9_000_000, 1, "2026-07-05"), // exec 큼, fee 90,000
        settlement("s2", "d2", 1_000_000, 10, "2026-07-06"), // exec 작음, fee 100,000
      ],
      members: [member("u1", "김영업"), member("u2", "이영업")],
    });
    expect(getLeaderboard(ctx, { repo, period: "2026-07" }).rows[0].userId).toBe("u2");
    expect(
      getLeaderboard(ctx, { repo, period: "2026-07", sort: "exec" }).rows[0].userId,
    ).toBe("u1");
  });

  it("멤버 정보가 없는 담당자도 집계에서 누락되지 않는다", () => {
    const repo = fakeRepo({
      deals: [deal("d1", { assigned_to: "ghost" })],
      settlements: [settlement("s1", "d1", 1_000_000, 3, "2026-07-05")],
      members: [],
    });
    const lb = getLeaderboard(ctx, { repo, period: "2026-07" });
    expect(lb.rows).toHaveLength(1);
    expect(lb.rows[0].userId).toBe("ghost");
    expect(lb.totals.feeSum).toBe(30_000);
  });
});

describe("getMonthlyContractCompanies", () => {
  it("이달 수납 고객사를 수수료 순으로 낸다", () => {
    const repo = fakeRepo({
      deals: [deal("d1", { company_id: "c1" }), deal("d2", { company_id: "c2" })],
      settlements: [
        settlement("s1", "d1", 1_000_000, 3, "2026-07-05"),
        settlement("s2", "d2", 5_000_000, 3, "2026-07-06"),
      ],
      companies: [
        { id: "c1", org_id: "o1", name: "가나상사" } as Company,
        { id: "c2", org_id: "o1", name: "다라전자" } as Company,
      ],
    });
    const r = getMonthlyContractCompanies(ctx, { repo, period: "2026-07" });
    expect(r.available).toBe(true);
    expect(r.top?.name).toBe("다라전자");
    expect(r.entries.map((e) => e.name)).toEqual(["다라전자", "가나상사"]);
  });

  it("수납이 없으면 available=false", () => {
    const r = getMonthlyContractCompanies(ctx, { repo: fakeRepo({}), period: "2026-07" });
    expect(r.available).toBe(false);
    expect(r.top).toBeNull();
  });
});

describe("buildPerf", () => {
  it("리더보드와 이달의 계약회사를 같은 기준월로 함께 조립한다", () => {
    const repo = fakeRepo({
      deals: [deal("d1", { assigned_to: "u1", company_id: "c1" })],
      settlements: [settlement("s1", "d1", 1_000_000, 3, "2026-07-05")],
      companies: [{ id: "c1", org_id: "o1", name: "가나상사" } as Company],
      members: [member("u1", "김영업")],
    });
    const perf = buildPerf(ctx, { repo, period: "2026-07" });

    expect(perf.period).toBe("2026-07");
    expect(perf.leaderboard.period).toBe("2026-07");
    expect(perf.contractCompanies.period).toBe("2026-07");
    // 두 위젯의 모집단이 동일하므로 수수료 합계가 일치한다.
    expect(perf.contractCompanies.top?.feeSum).toBe(perf.leaderboard.totals.feeSum);
  });
});
