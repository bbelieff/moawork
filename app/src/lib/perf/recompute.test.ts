// 월 마감 재계산(설계 §2.4) — 권한·멱등·정리 동작 검증.

import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/crm/errors";
import type { Repo } from "@/lib/repo";
import type { Ctx, Deal, IncentiveRule, Settlement } from "@/lib/types";
import { IncentiveConfigError } from "./incentive";
import { listSnapshots, recomputeSnapshots } from "./service";
import { InMemoryPerfStore } from "./store";

const PERIOD = "2026-07";

function fakeRepo(input: { settlements?: Settlement[]; deals?: Deal[] }): Repo {
  return {
    listSettlements: () => input.settlements ?? [],
    listDeals: () => input.deals ?? [],
    listCompanies: () => [],
    listMembers: () => [],
  } as unknown as Repo;
}

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

function settlement(id: string, dealId: string | null, exec = 10_000_000): Settlement {
  const fee = Math.round((exec * 3) / 100);
  return {
    id,
    org_id: "o1",
    deal_id: dealId,
    down_payment: 0,
    down_paid_at: null,
    exec_amount: exec,
    fee_pct: 3,
    fee_paid_at: "2026-07-15T00:00:00.000Z",
    fee_amount: fee,
    total_revenue: fee,
    d180: null,
    d365: null,
    created_at: "2026-07-01T00:00:00.000Z",
  } as Settlement;
}

function ctxWith(role: Ctx["role"], scope: Ctx["scope"]): Ctx {
  return {
    user: { id: "u1", email: null, name: null, avatar_url: null, created_at: "" },
    org: { id: "o1", name: "테스트", plan_tier: "t1_3", created_at: "" },
    role,
    scope,
  } as Ctx;
}

const OWNER = ctxWith("owner", "all");

const FLAT_10: IncentiveRule = {
  id: "r1",
  org_id: "o1",
  name: "고정 10%",
  base: "fee",
  type: "flat_pct",
  config_jsonb: { pct: 10 },
};

describe("recomputeSnapshots · 권한", () => {
  it("member+assigned 는 거부한다 — 부분집합으로 조직 전체를 덮어쓰면 안 된다", () => {
    expect(() =>
      recomputeSnapshots(ctxWith("member", "assigned"), {
        repo: fakeRepo({}),
        store: new InMemoryPerfStore(),
        period: PERIOD,
      }),
    ).toThrow(ForbiddenError);
  });

  it("owner · admin · scope=all 멤버는 허용한다", () => {
    for (const ctx of [
      ctxWith("owner", "all"),
      ctxWith("admin", "all"),
      ctxWith("member", "all"),
    ]) {
      expect(() =>
        recomputeSnapshots(ctx, {
          repo: fakeRepo({}),
          store: new InMemoryPerfStore(),
          period: PERIOD,
        }),
      ).not.toThrow();
    }
  });
});

describe("recomputeSnapshots · 저장", () => {
  it("담당자별 스냅샷을 저장하고 규칙명을 보고한다", () => {
    const store = new InMemoryPerfStore([FLAT_10]);
    const repo = fakeRepo({
      deals: [deal("d1", "u1"), deal("d2", "u2")],
      settlements: [settlement("s1", "d1"), settlement("s2", "d2")],
    });

    const result = recomputeSnapshots(OWNER, { repo, store, period: PERIOD });

    expect(result.period).toBe(PERIOD);
    expect(result.rowCount).toBe(2);
    expect(result.ruleName).toBe("고정 10%");
    expect(result.snapshots.map((s) => s.user_id)).toEqual(["u1", "u2"]);
    expect(result.snapshots[0].fee_sum).toBe(300_000);
    expect(result.snapshots[0].incentive_amount).toBe(30_000);
    expect(result.snapshots[0].org_id).toBe("o1");
  });

  it("규칙이 없으면 인센티브 0 · ruleName null", () => {
    const store = new InMemoryPerfStore();
    const result = recomputeSnapshots(OWNER, {
      repo: fakeRepo({
        deals: [deal("d1", "u1")],
        settlements: [settlement("s1", "d1")],
      }),
      store,
      period: PERIOD,
    });
    expect(result.ruleName).toBeNull();
    expect(result.snapshots[0].incentive_amount).toBe(0);
  });

  it("멱등 — 두 번 돌려도 행 수와 값이 같다", () => {
    const store = new InMemoryPerfStore([FLAT_10]);
    const repo = fakeRepo({
      deals: [deal("d1", "u1")],
      settlements: [settlement("s1", "d1")],
    });

    const first = recomputeSnapshots(OWNER, { repo, store, period: PERIOD });
    const second = recomputeSnapshots(OWNER, { repo, store, period: PERIOD });

    expect(second.rowCount).toBe(first.rowCount);
    expect(listSnapshots(OWNER, { store, period: PERIOD })).toHaveLength(1);
    expect(second.snapshots[0].fee_sum).toBe(first.snapshots[0].fee_sum);
  });

  it("정산이 사라지면 그 담당자의 옛 행도 함께 사라진다 (upsert 가 아니라 교체)", () => {
    const store = new InMemoryPerfStore([FLAT_10]);
    const deals = [deal("d1", "u1"), deal("d2", "u2")];

    recomputeSnapshots(OWNER, {
      repo: fakeRepo({ deals, settlements: [settlement("s1", "d1"), settlement("s2", "d2")] }),
      store,
      period: PERIOD,
    });
    expect(listSnapshots(OWNER, { store, period: PERIOD })).toHaveLength(2);

    // u2 의 정산이 삭제된 뒤 재계산.
    const after = recomputeSnapshots(OWNER, {
      repo: fakeRepo({ deals, settlements: [settlement("s1", "d1")] }),
      store,
      period: PERIOD,
    });

    expect(after.rowCount).toBe(1);
    const remaining = listSnapshots(OWNER, { store, period: PERIOD });
    expect(remaining.map((s) => s.user_id)).toEqual(["u1"]);
  });

  it("다른 달 스냅샷은 건드리지 않는다", () => {
    const store = new InMemoryPerfStore([FLAT_10]);
    const deals = [deal("d1", "u1")];

    recomputeSnapshots(OWNER, {
      repo: fakeRepo({ deals, settlements: [settlement("s1", "d1")] }),
      store,
      period: "2026-07",
    });
    recomputeSnapshots(OWNER, {
      repo: fakeRepo({
        deals,
        settlements: [
          { ...settlement("s2", "d1"), fee_paid_at: "2026-08-10T00:00:00.000Z" },
        ],
      }),
      store,
      period: "2026-08",
    });

    expect(listSnapshots(OWNER, { store, period: "2026-07" })).toHaveLength(1);
    expect(listSnapshots(OWNER, { store, period: "2026-08" })).toHaveLength(1);
    expect(listSnapshots(OWNER, { store })).toHaveLength(2);
  });

  it("규칙 설정이 깨졌으면 저장하지 않고 오류 — 기존 스냅샷이 남는다", () => {
    const store = new InMemoryPerfStore([FLAT_10]);
    const repo = fakeRepo({
      deals: [deal("d1", "u1")],
      settlements: [settlement("s1", "d1")],
    });

    recomputeSnapshots(OWNER, { repo, store, period: PERIOD });
    const before = listSnapshots(OWNER, { store, period: PERIOD });

    store.addRule({
      ...FLAT_10,
      id: "r2",
      name: "깨진 규칙",
      config_jsonb: { pct: "열" },
    });

    expect(() => recomputeSnapshots(OWNER, { repo, store, period: PERIOD })).toThrow(
      IncentiveConfigError,
    );
    expect(listSnapshots(OWNER, { store, period: PERIOD })).toEqual(before);
  });
});
