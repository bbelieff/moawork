import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import type { Ctx } from "@/lib/types";
import { parseCreateSettlement } from "./settlements";
import {
  toCreatePayload,
  toDerivedDisplay,
  DERIVED_KEYS,
} from "./settlement-form";

function ctxFor(userId: string): Ctx {
  const repo = getRepo();
  const user = repo.getUser(userId);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role: "owner", scope: "all" };
}

let owner: Ctx;

beforeEach(() => {
  resetDb();
  owner = ctxFor(SEED_USER_OWNER);
});

describe("페이로드 — base 컬럼만 전송", () => {
  it("입력 문자열을 숫자/날짜로 좁힌다", () => {
    expect(
      toCreatePayload({
        execAmount: "100000000",
        feePct: "3",
        downPayment: "500000",
        feePaidAt: "2026-01-10",
      }),
    ).toEqual({
      deal_id: null,
      exec_amount: 100_000_000,
      fee_pct: 3,
      down_payment: 500_000,
      fee_paid_at: "2026-01-10",
    });
  });

  it("빈 입금일은 null (D+n 미산출)", () => {
    const p = toCreatePayload({
      execAmount: "1000",
      feePct: "1",
      downPayment: "0",
      feePaidAt: "",
    });
    expect(p.fee_paid_at).toBeNull();
  });

  it("빈/비수치 금액은 0 으로 수렴", () => {
    const p = toCreatePayload({
      execAmount: "",
      feePct: "abc",
      downPayment: "",
      feePaidAt: "",
    });
    expect([p.exec_amount, p.fee_pct, p.down_payment]).toEqual([0, 0, 0]);
  });

  it("dealId 를 주면 딜에 귀속시킨다", () => {
    const p = toCreatePayload(
      { execAmount: "1", feePct: "1", downPayment: "0", feePaidAt: "" },
      "deal-1",
    );
    expect(p.deal_id).toBe("deal-1");
  });

  it("⚠ 파생 키를 절대 포함하지 않는다(서버 400 방지)", () => {
    const p = toCreatePayload({
      execAmount: "100",
      feePct: "3",
      downPayment: "1",
      feePaidAt: "2026-01-10",
    });
    for (const k of DERIVED_KEYS) expect(k in p).toBe(false);
  });

  it("페이로드가 서버 검증(parseCreateSettlement)을 그대로 통과한다", () => {
    const p = toCreatePayload({
      execAmount: "100000000",
      feePct: "3",
      downPayment: "500000",
      feePaidAt: "2026-01-10",
    });
    expect(() => parseCreateSettlement(p)).not.toThrow();
  });
});

describe("수용기준 — 화면 표시값 = DB generated column 값", () => {
  it("서버 레코드의 파생값을 그대로 표시한다(재계산 없음)", () => {
    // 서버 경로 그대로: 폼 입력 → 페이로드 → 저장 → 레코드
    const payload = toCreatePayload({
      execAmount: "100000000",
      feePct: "3",
      downPayment: "500000",
      feePaidAt: "2026-01-10",
    });
    const saved = getRepo().createSettlement(owner, parseCreateSettlement(payload));
    const shown = toDerivedDisplay(saved);

    // 표시값은 저장 레코드의 파생 컬럼과 **동일 참조값**이어야 한다.
    expect(shown.feeAmount).toBe(saved.fee_amount);
    expect(shown.totalRevenue).toBe(saved.total_revenue);
    expect(shown.d180).toBe(saved.d180);
    expect(shown.d365).toBe(saved.d365);

    // 002_seed formulas 확정본과의 정합(회귀 가드).
    expect(shown.feeAmount).toBe(3_000_000);
    expect(shown.totalRevenue).toBe(3_500_000);
    expect(shown.d180).toBe("2026-07-09");
    expect(shown.d365).toBe("2027-01-10");
  });

  it("입금일 미정이면 D+n 은 null 로 표시된다", () => {
    const payload = toCreatePayload({
      execAmount: "50000000",
      feePct: "2",
      downPayment: "0",
      feePaidAt: "",
    });
    const saved = getRepo().createSettlement(owner, parseCreateSettlement(payload));
    const shown = toDerivedDisplay(saved);
    expect(shown.feeAmount).toBe(1_000_000);
    expect(shown.d180).toBeNull();
    expect(shown.d365).toBeNull();
  });

  it("반올림 경계도 서버 값을 따른다", () => {
    // 12,345,678 × 3% = 370,370.34 → 370,370
    const payload = toCreatePayload({
      execAmount: "12345678",
      feePct: "3",
      downPayment: "0",
      feePaidAt: "",
    });
    const saved = getRepo().createSettlement(owner, parseCreateSettlement(payload));
    expect(toDerivedDisplay(saved).feeAmount).toBe(saved.fee_amount);
    expect(toDerivedDisplay(saved).feeAmount).toBe(370_370);
  });
});

describe("수용기준 가드 — 화면 코드에 산식 사본이 없다", () => {
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("SettlementForm.tsx 가 산식 함수를 import 하지 않는다", () => {
    const src = read("../../components/policyfund/SettlementForm.tsx");
    for (const banned of [
      "computeSettlement",
      "feeAmount(",
      "totalRevenue(",
      "dPlus(",
      "sumTotalRevenue",
    ]) {
      expect(src).not.toContain(banned);
    }
  });

  it("settlement-form.ts 에 산술 연산자가 없다(복사 전용)", () => {
    const src = read("./settlement-form.ts")
      // 주석 제거 후 검사(주석의 수식 설명은 무해).
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const op of ["* ", "/ 100", "+ ", "Math.round"]) {
      expect(src).not.toContain(op);
    }
  });
});
