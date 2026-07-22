import { describe, it, expect, beforeEach } from "vitest";
import { ValidationError } from "@/lib/crm";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import type { Ctx, Settlement } from "@/lib/types";
import {
  SettlementsService,
  parseCreateSettlement,
  parseUpdateSettlement,
  summarize,
  dueBy,
} from "./settlements";

function ctxFor(userId: string): Ctx {
  const repo = getRepo();
  const user = repo.getUser(userId);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role: "owner", scope: "all" };
}

let svc: SettlementsService;
let owner: Ctx;

beforeEach(() => {
  resetDb();
  svc = new SettlementsService();
  owner = ctxFor(SEED_USER_OWNER);
});

describe("검증 — parseCreateSettlement", () => {
  it("정상 입력을 NewSettlement 로 좁힌다", () => {
    expect(
      parseCreateSettlement({
        deal_id: null,
        exec_amount: 100_000_000,
        fee_pct: 3,
        down_payment: 500_000,
        fee_paid_at: "2026-01-10",
      }),
    ).toEqual({
      deal_id: null,
      exec_amount: 100_000_000,
      fee_pct: 3,
      down_payment: 500_000,
      down_paid_at: null,
      fee_paid_at: "2026-01-10",
    });
  });

  it("fee_pct 는 정수 퍼센트여야 한다 (3.5 거절)", () => {
    expect(() => parseCreateSettlement({ fee_pct: 3.5 })).toThrow(ValidationError);
  });

  it("fee_pct 범위 0~100 밖은 거절", () => {
    expect(() => parseCreateSettlement({ fee_pct: 101 })).toThrow(ValidationError);
    expect(() => parseCreateSettlement({ fee_pct: -1 })).toThrow(ValidationError);
  });

  it("음수 금액 거절", () => {
    expect(() => parseCreateSettlement({ exec_amount: -1 })).toThrow(ValidationError);
    expect(() => parseCreateSettlement({ down_payment: -1 })).toThrow(ValidationError);
  });

  it("날짜는 YYYY-MM-DD 만 허용", () => {
    expect(() => parseCreateSettlement({ fee_paid_at: "2026/01/10" })).toThrow(
      ValidationError,
    );
  });

  it("파생 컬럼 입력은 거절한다(읽기 전용)", () => {
    for (const k of ["fee_amount", "total_revenue", "d180", "d365"]) {
      expect(() => parseCreateSettlement({ [k]: 1 })).toThrow(ValidationError);
    }
  });
});

describe("검증 — parseUpdateSettlement", () => {
  it("주어진 키만 패치에 담는다", () => {
    expect(parseUpdateSettlement({ fee_pct: 5 })).toEqual({ fee_pct: 5 });
    expect(parseUpdateSettlement({})).toEqual({});
  });

  it("파생 컬럼 패치는 거절", () => {
    expect(() => parseUpdateSettlement({ total_revenue: 10 })).toThrow(ValidationError);
  });
});

describe("서비스 — 파생값 정합(002_seed formulas 확정본)", () => {
  it("수수료=round(실행액×%/100) · 총매출=계약금+수수료 · D+180/365=수수료입금일 기준", () => {
    const s = svc.create(owner, {
      deal_id: null,
      exec_amount: 100_000_000,
      fee_pct: 3,
      down_payment: 500_000,
      fee_paid_at: "2026-01-10",
    });
    expect(s.fee_amount).toBe(3_000_000);
    expect(s.total_revenue).toBe(3_500_000);
    expect(s.d180).toBe("2026-07-09");
    expect(s.d365).toBe("2027-01-10");
  });

  it("수수료 미입금이면 D+180/365 는 null", () => {
    const s = svc.create(owner, {
      deal_id: null,
      exec_amount: 50_000_000,
      fee_pct: 2,
      fee_paid_at: null,
    });
    expect(s.fee_amount).toBe(1_000_000);
    expect(s.d180).toBeNull();
    expect(s.d365).toBeNull();
  });

  it("수정 시 파생값이 재계산된다", () => {
    const s = svc.create(owner, { deal_id: null, exec_amount: 10_000_000, fee_pct: 1 });
    expect(s.fee_amount).toBe(100_000);
    const u = svc.update(owner, s.id, { fee_pct: 4 });
    expect(u?.fee_amount).toBe(400_000);
  });

  it("반올림은 원 단위", () => {
    // 12,345,678 × 3% = 370,370.34 → 370,370
    const s = svc.create(owner, { deal_id: null, exec_amount: 12_345_678, fee_pct: 3 });
    expect(s.fee_amount).toBe(370_370);
  });
});

describe("서비스 — CRUD", () => {
  it("생성·조회·수정·삭제", () => {
    const s = svc.create(owner, { deal_id: null, exec_amount: 1_000, fee_pct: 10 });
    expect(svc.get(owner, s.id)?.id).toBe(s.id);
    expect(svc.list(owner)).toHaveLength(1);
    expect(svc.update(owner, s.id, { down_payment: 7 })?.down_payment).toBe(7);
    expect(svc.remove(owner, s.id)).toBe(true);
    expect(svc.get(owner, s.id)).toBeUndefined();
  });

  it("없는 id 는 undefined/false", () => {
    expect(svc.get(owner, "nope")).toBeUndefined();
    expect(svc.update(owner, "nope", { fee_pct: 1 })).toBeUndefined();
    expect(svc.remove(owner, "nope")).toBe(false);
  });
});

describe("집계 — summarize", () => {
  it("합계와 입금 건수를 집계한다", () => {
    svc.create(owner, {
      deal_id: null,
      exec_amount: 100_000_000,
      fee_pct: 3,
      down_payment: 500_000,
      fee_paid_at: "2026-01-10",
    });
    svc.create(owner, {
      deal_id: null,
      exec_amount: 50_000_000,
      fee_pct: 2,
      down_payment: 0,
      fee_paid_at: null,
    });

    const { summary } = svc.listWithSummary(owner);
    expect(summary.count).toBe(2);
    expect(summary.execAmount).toBe(150_000_000);
    expect(summary.downPayment).toBe(500_000);
    expect(summary.feeAmount).toBe(4_000_000); // 3,000,000 + 1,000,000
    expect(summary.totalRevenue).toBe(4_500_000);
    expect(summary.feePaidCount).toBe(1);
    expect(summary.feeUnpaidCount).toBe(1);
  });

  it("빈 목록은 0 으로 수렴", () => {
    expect(summarize([])).toEqual({
      count: 0,
      execAmount: 0,
      downPayment: 0,
      feeAmount: 0,
      totalRevenue: 0,
      feePaidCount: 0,
      feeUnpaidCount: 0,
    });
  });
});

describe("집계 — dueBy(D+180 / D+365 도래)", () => {
  const mk = (d180: string | null, d365: string | null): Settlement =>
    ({ d180, d365 }) as Settlement;

  it("기준일 이전 도래분만 고른다", () => {
    const items = [mk("2026-07-09", "2027-01-10"), mk("2026-12-01", "2027-06-01")];
    expect(dueBy(items, "d180", "2026-08-01")).toHaveLength(1);
    expect(dueBy(items, "d180", "2026-12-31")).toHaveLength(2);
    expect(dueBy(items, "d365", "2026-08-01")).toHaveLength(0);
  });

  it("기산일 미정(null)은 제외", () => {
    expect(dueBy([mk(null, null)], "d180", "2099-01-01")).toHaveLength(0);
  });
});
