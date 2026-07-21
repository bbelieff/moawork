import { describe, it, expect } from "vitest";
import type { Company, Deal, Settlement, User } from "@/lib/types";
import {
  NO_COMPANY_LABEL,
  NO_NAME_LABEL,
  UNASSIGNED_LABEL,
  buildLeaderboard,
  buildMonthlyContractCompanies,
  displayName,
  monthRangeKst,
  settlementsPaidIn,
} from "./aggregate";

// ── 픽스처 ────────────────────────────────────────────────

const PERIOD = "2026-07";

function user(id: string, patch: Partial<User> = {}): User {
  return {
    id,
    email: `${id}@example.com`,
    name: `사용자${id}`,
    avatar_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...patch,
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

function company(id: string, name: string): Company {
  return {
    id,
    org_id: "o1",
    name,
    biz_type: null,
    region: null,
    owner_name: null,
    phone: null,
    email: null,
    revenue: null,
    founded_on: null,
    homepage: null,
    assigned_to: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as Company;
}

/** exec_amount / fee_pct 로부터 001 generated column 과 동일하게 파생값을 채운다. */
function settlement(
  id: string,
  dealId: string | null,
  execAmount: number,
  feePct: number,
  feePaidAt: string | null,
  downPayment = 0,
): Settlement {
  const feeAmount = Math.round((execAmount * feePct) / 100);
  return {
    id,
    org_id: "o1",
    deal_id: dealId,
    down_payment: downPayment,
    down_paid_at: null,
    exec_amount: execAmount,
    fee_pct: feePct,
    fee_paid_at: feePaidAt,
    fee_amount: feeAmount,
    total_revenue: downPayment + feeAmount,
    d180: null,
    d365: null,
    created_at: "2026-07-01T00:00:00.000Z",
  };
}

// ── 기간 귀속 ─────────────────────────────────────────────

describe("settlementsPaidIn — 귀속월 필터(fee_paid_at)", () => {
  const range = monthRangeKst(PERIOD);

  it("fee_paid_at 이 null 인 미실현 정산은 제외한다", () => {
    const rows = settlementsPaidIn([settlement("s1", "d1", 1000, 3, null)], range);
    expect(rows).toHaveLength(0);
  });

  it("KST 월 경계를 지킨다 (7/1 00:00 KST = 6/30 15:00 UTC 포함, 그 직전 제외)", () => {
    const inside = settlement("s1", "d1", 1000, 3, "2026-06-30T15:00:00.000Z");
    const outside = settlement("s2", "d2", 1000, 3, "2026-06-30T14:59:59.999Z");
    const rows = settlementsPaidIn([inside, outside], range);
    expect(rows.map((s) => s.id)).toEqual(["s1"]);
  });

  it("날짜만 있는 값(YYYY-MM-DD)도 해당 월로 판정한다", () => {
    const rows = settlementsPaidIn(
      [
        settlement("s1", "d1", 1000, 3, "2026-07-31"),
        settlement("s2", "d2", 1000, 3, "2026-08-01"),
        settlement("s3", "d3", 1000, 3, "2026-06-30"),
      ],
      range,
    );
    expect(rows.map((s) => s.id)).toEqual(["s1"]);
  });
});

describe("displayName", () => {
  it("name → email → '(이름없음)' 순으로 폴백한다", () => {
    expect(displayName(user("u1", { name: "홍길동" }))).toBe("홍길동");
    expect(displayName(user("u1", { name: "  " }))).toBe("u1@example.com");
    expect(displayName(user("u1", { name: null, email: null }))).toBe(NO_NAME_LABEL);
    expect(displayName(undefined)).toBe(NO_NAME_LABEL);
  });
});

// ── 리더보드 ──────────────────────────────────────────────

describe("buildLeaderboard — 담당자별 실적 집계", () => {
  const users = [user("u1", { name: "김영업" }), user("u2", { name: "이영업" })];
  const deals = [
    deal("d1", { assigned_to: "u1" }),
    deal("d2", { assigned_to: "u1" }),
    deal("d3", { assigned_to: "u2" }),
    deal("d4", { assigned_to: null }), // 미배정
  ];

  it("담당자별로 건수·실행액·수수료를 합산하고 수수료 순으로 순위를 매긴다", () => {
    const settlements = [
      settlement("s1", "d1", 1_000_000, 3, "2026-07-05"), // u1 fee 30,000
      settlement("s2", "d2", 2_000_000, 3, "2026-07-10"), // u1 fee 60,000
      settlement("s3", "d3", 5_000_000, 3, "2026-07-15"), // u2 fee 150,000
    ];
    const lb = buildLeaderboard(settlements, deals, users, PERIOD);

    expect(lb.rows).toHaveLength(2);
    expect(lb.rows[0]).toMatchObject({
      userId: "u2",
      name: "이영업",
      dealCount: 1,
      execSum: 5_000_000,
      feeSum: 150_000,
      rank: 1,
    });
    expect(lb.rows[1]).toMatchObject({
      userId: "u1",
      dealCount: 2,
      execSum: 3_000_000,
      feeSum: 90_000,
      rank: 2,
    });
  });

  it("정렬 기준(exec/deals)을 바꾸면 순위가 바뀐다", () => {
    const settlements = [
      settlement("s1", "d1", 1_000_000, 3, "2026-07-05"),
      settlement("s2", "d2", 2_000_000, 3, "2026-07-10"), // u1 합계 300만, 2건
      settlement("s3", "d3", 5_000_000, 1, "2026-07-15"), // u2 500만, 1건, fee 50,000
    ];
    expect(buildLeaderboard(settlements, deals, users, PERIOD, "exec").rows[0].userId).toBe(
      "u2",
    );
    expect(
      buildLeaderboard(settlements, deals, users, PERIOD, "deals").rows[0].userId,
    ).toBe("u1");
  });

  it("동점은 같은 순위를 공유하고 다음 순위를 건너뛴다 (1,2,2,4)", () => {
    const many = [
      deal("d1", { assigned_to: "u1" }),
      deal("d2", { assigned_to: "u2" }),
      deal("d3", { assigned_to: "u3" }),
      deal("d4", { assigned_to: "u4" }),
    ];
    const manyUsers = [
      user("u1", { name: "가" }),
      user("u2", { name: "나" }),
      user("u3", { name: "다" }),
      user("u4", { name: "라" }),
    ];
    const settlements = [
      settlement("s1", "d1", 1_000_000, 10, "2026-07-05"), // 100,000
      settlement("s2", "d2", 1_000_000, 5, "2026-07-05"), //  50,000
      settlement("s3", "d3", 1_000_000, 5, "2026-07-05"), //  50,000 (동점)
      settlement("s4", "d4", 1_000_000, 1, "2026-07-05"), //  10,000
    ];
    const lb = buildLeaderboard(settlements, many, manyUsers, PERIOD);
    expect(lb.rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("미배정 정산은 순위 밖 버킷으로 분리하되 합계에는 포함한다", () => {
    const settlements = [
      settlement("s1", "d1", 1_000_000, 3, "2026-07-05"), // u1
      settlement("s2", "d4", 4_000_000, 3, "2026-07-06"), // 미배정 딜
      settlement("s3", null, 5_000_000, 3, "2026-07-07"), // 딜 자체가 없음
    ];
    const lb = buildLeaderboard(settlements, deals, users, PERIOD);

    expect(lb.rows.map((r) => r.userId)).toEqual(["u1"]);
    expect(lb.unassigned).toMatchObject({
      userId: null,
      name: UNASSIGNED_LABEL,
      dealCount: 2,
      execSum: 9_000_000,
      rank: null,
    });
    // 합계 = 배정 + 미배정
    expect(lb.totals).toEqual({
      dealCount: 3,
      execSum: 10_000_000,
      feeSum: 30_000 + 120_000 + 150_000,
    });
  });

  it("미배정 정산이 없으면 unassigned 는 null 이다", () => {
    const lb = buildLeaderboard(
      [settlement("s1", "d1", 1_000_000, 3, "2026-07-05")],
      deals,
      users,
      PERIOD,
    );
    expect(lb.unassigned).toBeNull();
  });

  it("데이터 0건이면 빈 리더보드와 0 합계를 낸다 (NaN 없음)", () => {
    const lb = buildLeaderboard([], [], [], PERIOD);
    expect(lb.rows).toEqual([]);
    expect(lb.unassigned).toBeNull();
    expect(lb.totals).toEqual({ dealCount: 0, execSum: 0, feeSum: 0 });
    expect(Number.isFinite(lb.totals.feeSum)).toBe(true);
  });

  it("다른 달 수납은 집계에서 빠진다", () => {
    const lb = buildLeaderboard(
      [
        settlement("s1", "d1", 1_000_000, 3, "2026-07-05"),
        settlement("s2", "d2", 9_000_000, 3, "2026-08-05"),
      ],
      deals,
      users,
      PERIOD,
    );
    expect(lb.totals.dealCount).toBe(1);
    expect(lb.totals.execSum).toBe(1_000_000);
  });

  it("수수료는 generated column(fee_amount)을 그대로 합산한다 — 재반올림하지 않는다", () => {
    // exec 333,333 × 3% = 9,999.99 → DB 가 round 하여 10,000 으로 저장된 상황.
    const s = settlement("s1", "d1", 333_333, 3, "2026-07-05");
    expect(s.fee_amount).toBe(10_000);
    const lb = buildLeaderboard([s], deals, users, PERIOD);
    expect(lb.rows[0].feeSum).toBe(10_000);
  });
});

// ── 이달의 계약회사 ────────────────────────────────────────

describe("buildMonthlyContractCompanies", () => {
  const companies = [company("c1", "가나상사"), company("c2", "다라전자")];
  const deals = [
    deal("d1", { company_id: "c1" }),
    deal("d2", { company_id: "c1" }),
    deal("d3", { company_id: "c2" }),
    deal("d4", { company_id: null }),
  ];

  it("고객사별로 묶고 수수료 순으로 정렬하며 1위를 top 으로 낸다", () => {
    const settlements = [
      settlement("s1", "d1", 1_000_000, 3, "2026-07-05"), // c1 30,000
      settlement("s2", "d2", 2_000_000, 3, "2026-07-20"), // c1 60,000
      settlement("s3", "d3", 1_000_000, 5, "2026-07-10"), // c2 50,000
    ];
    const r = buildMonthlyContractCompanies(settlements, deals, companies, PERIOD);

    expect(r.available).toBe(true);
    expect(r.top).toMatchObject({
      companyId: "c1",
      name: "가나상사",
      dealCount: 2,
      execSum: 3_000_000,
      feeSum: 90_000,
    });
    expect(r.entries.map((e) => e.companyId)).toEqual(["c1", "c2"]);
    // 이달 수납 중 가장 늦은 날짜
    expect(r.top?.latestPaidAt).toBe("2026-07-20");
  });

  it("고객사가 연결되지 않은 정산은 '(고객사 미지정)' 으로 모은다", () => {
    const r = buildMonthlyContractCompanies(
      [
        settlement("s1", "d4", 1_000_000, 3, "2026-07-05"), // 딜에 회사 없음
        settlement("s2", null, 1_000_000, 3, "2026-07-06"), // 딜 자체 없음
      ],
      deals,
      companies,
      PERIOD,
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({
      companyId: null,
      name: NO_COMPANY_LABEL,
      dealCount: 2,
    });
  });

  it("이번달 수납이 없으면 available=false, top=null 이다", () => {
    const r = buildMonthlyContractCompanies(
      [settlement("s1", "d1", 1_000_000, 3, "2026-08-05")],
      deals,
      companies,
      PERIOD,
    );
    expect(r.available).toBe(false);
    expect(r.top).toBeNull();
    expect(r.entries).toEqual([]);
  });

  it("리더보드와 모집단이 같다 — 합계가 일치한다", () => {
    const settlements = [
      settlement("s1", "d1", 1_000_000, 3, "2026-07-05"),
      settlement("s2", "d3", 2_000_000, 3, "2026-07-06"),
      settlement("s3", "d4", 3_000_000, 3, "2026-07-07"),
      settlement("s4", "d1", 9_000_000, 3, "2026-08-07"), // 다른 달
    ];
    const lb = buildLeaderboard(settlements, deals, [], PERIOD);
    const cc = buildMonthlyContractCompanies(settlements, deals, companies, PERIOD);
    const ccTotal = cc.entries.reduce((n, e) => n + e.feeSum, 0);
    expect(ccTotal).toBe(lb.totals.feeSum);
  });
});
