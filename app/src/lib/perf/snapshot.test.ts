import { describe, expect, it } from "vitest";
import type { Deal, IncentiveRule, Settlement } from "@/lib/types";
import { buildSnapshotRows, previousMonthKst } from "./snapshot";

const PERIOD = "2026-07";

function deal(id: string, assignedTo: string | null): Deal {
  return {
    id,
    org_id: "o1",
    company_id: null,
    pipeline_id: "p1",
    stage_id: null,
    assigned_to: assignedTo,
    title: `딜 ${id}`,
    amount: null,
    status_note: null,
    applied_on: null,
    custom: {},
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  } as Deal;
}

/** exec_amount·fee_pct 로부터 001 generated column 과 같은 식으로 파생값을 채운다. */
function settlement(
  id: string,
  dealId: string | null,
  patch: Partial<Settlement> = {},
): Settlement {
  const exec = patch.exec_amount ?? 10_000_000;
  const pct = patch.fee_pct ?? 3;
  const down = patch.down_payment ?? 0;
  const fee = Math.round((exec * pct) / 100);
  return {
    id,
    org_id: "o1",
    deal_id: dealId,
    down_payment: down,
    down_paid_at: null,
    exec_amount: exec,
    fee_pct: pct,
    fee_paid_at: "2026-07-15T00:00:00.000Z",
    fee_amount: fee,
    total_revenue: down + fee,
    d180: null,
    d365: null,
    created_at: "2026-07-01T00:00:00.000Z",
    ...patch,
  } as Settlement;
}

const FLAT_10: IncentiveRule = {
  id: "r1",
  org_id: "o1",
  name: "고정 10%",
  base: "fee",
  type: "flat_pct",
  config_jsonb: { pct: 10 },
};

describe("buildSnapshotRows", () => {
  it("담당자별로 건수·수수료합·인센티브를 집계한다", () => {
    const deals = [deal("d1", "u1"), deal("d2", "u1"), deal("d3", "u2")];
    const settlements = [
      settlement("s1", "d1"), // fee 300,000
      settlement("s2", "d2"), // fee 300,000
      settlement("s3", "d3"), // fee 300,000
    ];

    const rows = buildSnapshotRows(settlements, deals, PERIOD, FLAT_10);

    expect(rows).toEqual([
      {
        user_id: "u1",
        period: PERIOD,
        contracts_cnt: 2,
        fee_sum: 600_000,
        incentive_amount: 60_000,
      },
      {
        user_id: "u2",
        period: PERIOD,
        contracts_cnt: 1,
        fee_sum: 300_000,
        incentive_amount: 30_000,
      },
    ]);
  });

  it("fee_paid_at 이 null(미실현)이거나 타월이면 제외한다", () => {
    const deals = [deal("d1", "u1")];
    const rows = buildSnapshotRows(
      [
        settlement("s1", "d1"),
        settlement("s2", "d1", { fee_paid_at: null }),
        settlement("s3", "d1", { fee_paid_at: "2026-06-30T00:00:00.000Z" }),
      ],
      deals,
      PERIOD,
      FLAT_10,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].contracts_cnt).toBe(1);
  });

  it("KST 월 경계를 쓴다 — 6/30 15:00Z 는 7월분", () => {
    const deals = [deal("d1", "u1")];
    const rows = buildSnapshotRows(
      [settlement("s1", "d1", { fee_paid_at: "2026-06-30T15:00:00.000Z" })],
      deals,
      PERIOD,
      FLAT_10,
    );
    expect(rows[0].contracts_cnt).toBe(1);
  });

  it("담당자 없는/딜 없는 정산은 미배정 버킷이며 인센티브는 0", () => {
    const deals = [deal("d1", "u1"), deal("d2", null)];
    const rows = buildSnapshotRows(
      [
        settlement("s1", "d1"),
        settlement("s2", "d2"), // 담당자 없음
        settlement("s3", null), // 딜 연결 없음
      ],
      deals,
      PERIOD,
      FLAT_10,
    );

    const unassigned = rows.find((r) => r.user_id === null);
    expect(unassigned).toEqual({
      user_id: null,
      period: PERIOD,
      contracts_cnt: 2,
      fee_sum: 600_000,
      incentive_amount: 0, // 지급 대상자 없음
    });
    // 미배정 버킷은 항상 마지막.
    expect(rows[rows.length - 1].user_id).toBeNull();
  });

  it("미배정 정산이 없으면 버킷 행 자체를 만들지 않는다", () => {
    const rows = buildSnapshotRows(
      [settlement("s1", "d1")],
      [deal("d1", "u1")],
      PERIOD,
      FLAT_10,
    );
    expect(rows.every((r) => r.user_id !== null)).toBe(true);
  });

  it("규칙이 없으면 인센티브 0 (집계는 그대로)", () => {
    const rows = buildSnapshotRows(
      [settlement("s1", "d1")],
      [deal("d1", "u1")],
      PERIOD,
      null,
    );
    expect(rows[0].fee_sum).toBe(300_000);
    expect(rows[0].incentive_amount).toBe(0);
  });

  it("멱등 — 같은 입력이면 같은 행(순서 포함)", () => {
    const deals = [deal("d1", "u2"), deal("d2", "u1")];
    const settlements = [settlement("s1", "d1"), settlement("s2", "d2")];
    const first = buildSnapshotRows(settlements, deals, PERIOD, FLAT_10);
    const second = buildSnapshotRows(settlements, deals, PERIOD, FLAT_10);
    expect(second).toEqual(first);
    expect(first.map((r) => r.user_id)).toEqual(["u1", "u2"]);
  });

  it("대상 정산이 하나도 없으면 빈 목록", () => {
    expect(buildSnapshotRows([], [], PERIOD, FLAT_10)).toEqual([]);
  });

  it("수수료 합은 generated column 값을 그대로 더한다(재반올림 없음)", () => {
    // exec 333,333 × 3% = 9,999.99 → DB round = 10,000. 두 건이면 20,000.
    const rows = buildSnapshotRows(
      [
        settlement("s1", "d1", { exec_amount: 333_333, fee_pct: 3 }),
        settlement("s2", "d1", { exec_amount: 333_333, fee_pct: 3 }),
      ],
      [deal("d1", "u1")],
      PERIOD,
      null,
    );
    expect(rows[0].fee_sum).toBe(20_000);
  });
});

describe("previousMonthKst", () => {
  it("KST 기준 전월을 돌려준다", () => {
    expect(previousMonthKst(new Date("2026-08-01T00:00:00.000Z"))).toBe("2026-07");
  });

  it("연 경계를 넘긴다", () => {
    expect(previousMonthKst(new Date("2026-01-01T00:00:00.000Z"))).toBe("2025-12");
  });

  it("UTC 로는 아직 7월이어도 KST 로 8월이면 전월은 7월", () => {
    // 2026-07-31T20:00Z = KST 2026-08-01 05:00
    expect(previousMonthKst(new Date("2026-07-31T20:00:00.000Z"))).toBe("2026-07");
  });

  it("KST 로 아직 7월이면 전월은 6월", () => {
    // 2026-07-31T14:00Z = KST 2026-07-31 23:00
    expect(previousMonthKst(new Date("2026-07-31T14:00:00.000Z"))).toBe("2026-06");
  });
});
