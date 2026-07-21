/**
 * T09 · 정산(settlements) 업무 로직 — 검증 · 서비스 · 집계.
 *
 * 경계
 *  - 포트/타입(`@/lib/repo`, `@/lib/types`) = T03 소유. 여기서는 **소비만** 한다.
 *  - 파생값(fee_amount·total_revenue·d180·d365)은 001 의 generated column 이라
 *    입력 불가·읽기 전용. 산식 정본은 002_seed 의 formulas 블록이며,
 *    순수 함수 구현은 `./settlement`(computeSettlement) — 본 모듈은 저장된
 *    레코드의 파생값을 그대로 집계한다(재계산하지 않음 = 단일 진실 소스 유지).
 *  - HTTP 매핑은 `@/lib/crm` 의 ValidationError/에러 응답 헬퍼를 재사용한다.
 */

import { ValidationError } from "@/lib/crm";
import { getRepo, type NewSettlement, type SettlementPatch } from "@/lib/repo";
import type { Ctx, Settlement } from "@/lib/types";

// ── 검증 ──────────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 금액(원). null 허용, 음수 불가. */
function optAmount(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`${field}: 숫자여야 합니다`);
  if (n < 0) throw new ValidationError(`${field}: 0 이상이어야 합니다`);
  return n;
}

/** 수수료율 — 정수 퍼센트(3 = 3%). 0~100. */
function optFeePct(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`${field}: 숫자여야 합니다`);
  if (!Number.isInteger(n))
    throw new ValidationError(`${field}: 정수 퍼센트여야 합니다 (3 = 3%)`);
  if (n < 0 || n > 100) throw new ValidationError(`${field}: 0~100 범위여야 합니다`);
  return n;
}

/** YYYY-MM-DD. null 허용. */
function optDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ValidationError(`${field}: YYYY-MM-DD 형식이어야 합니다`);
  return v;
}

function optDealId(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new ValidationError(`${field}: 문자열이어야 합니다`);
  return v;
}

/** 생성 요청 바디 → NewSettlement. 파생 컬럼은 받지 않는다. */
export function parseCreateSettlement(body: unknown): NewSettlement {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  rejectDerived(body);
  return {
    deal_id: optDealId(body.deal_id, "deal_id"),
    down_payment: optAmount(body.down_payment, "down_payment"),
    down_paid_at: optDate(body.down_paid_at, "down_paid_at"),
    exec_amount: optAmount(body.exec_amount, "exec_amount"),
    fee_pct: optFeePct(body.fee_pct, "fee_pct"),
    fee_paid_at: optDate(body.fee_paid_at, "fee_paid_at"),
  };
}

/** 수정 요청 바디 → SettlementPatch. 주어진 키만 담는다(부분 수정). */
export function parseUpdateSettlement(body: unknown): SettlementPatch {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  rejectDerived(body);
  const patch: SettlementPatch = {};
  if ("deal_id" in body) patch.deal_id = optDealId(body.deal_id, "deal_id");
  if ("down_payment" in body)
    patch.down_payment = optAmount(body.down_payment, "down_payment");
  if ("down_paid_at" in body)
    patch.down_paid_at = optDate(body.down_paid_at, "down_paid_at");
  if ("exec_amount" in body)
    patch.exec_amount = optAmount(body.exec_amount, "exec_amount");
  if ("fee_pct" in body) patch.fee_pct = optFeePct(body.fee_pct, "fee_pct");
  if ("fee_paid_at" in body)
    patch.fee_paid_at = optDate(body.fee_paid_at, "fee_paid_at");
  return patch;
}

/** 파생 컬럼은 읽기 전용 — 입력에 섞여 오면 조용히 무시하지 않고 거절한다. */
const DERIVED_KEYS = ["fee_amount", "total_revenue", "d180", "d365"] as const;

function rejectDerived(body: Record<string, unknown>): void {
  for (const k of DERIVED_KEYS) {
    if (k in body)
      throw new ValidationError(`${k}: 파생 컬럼이라 입력할 수 없습니다(읽기 전용)`);
  }
}

// ── 집계 ──────────────────────────────────────────────────────────────────

/** 정산 집계 요약. 금액은 원 단위. */
export interface SettlementSummary {
  /** 정산 건수. */
  count: number;
  /** 실행액 합계. */
  execAmount: number;
  /** 계약금 합계. */
  downPayment: number;
  /** 수수료 합계(파생값 그대로 합산). */
  feeAmount: number;
  /** 총매출 합계 = 계약금 + 수수료. */
  totalRevenue: number;
  /** 수수료 입금 완료 건수(fee_paid_at 있음). */
  feePaidCount: number;
  /** 수수료 미입금 건수. */
  feeUnpaidCount: number;
}

/** 정산 레코드 목록을 합산한다. 파생값은 저장된 값을 그대로 쓴다. */
export function summarize(items: readonly Settlement[]): SettlementSummary {
  const sum: SettlementSummary = {
    count: items.length,
    execAmount: 0,
    downPayment: 0,
    feeAmount: 0,
    totalRevenue: 0,
    feePaidCount: 0,
    feeUnpaidCount: 0,
  };
  for (const s of items) {
    sum.execAmount += s.exec_amount;
    sum.downPayment += s.down_payment;
    sum.feeAmount += s.fee_amount;
    sum.totalRevenue += s.total_revenue;
    if (s.fee_paid_at) sum.feePaidCount += 1;
    else sum.feeUnpaidCount += 1;
  }
  return sum;
}

/** D+180 / D+365 중 어느 기준으로 도래를 볼지. */
export type DueMilestone = "d180" | "d365";

/**
 * 기준일(asOf) 이전에 도래한(=지난) 마일스톤 건을 고른다.
 * 기산일(fee_paid_at) 미입력이면 d180/d365 가 null 이라 제외된다.
 * asOf 는 호출부가 주입한다(테스트 결정성).
 */
export function dueBy(
  items: readonly Settlement[],
  milestone: DueMilestone,
  asOf: string,
): Settlement[] {
  return items.filter((s) => {
    const d = s[milestone];
    return d !== null && d <= asOf;
  });
}

// ── 서비스 ────────────────────────────────────────────────────────────────

/**
 * 정산 서비스. 담당범위(scope) 격리는 repo 포트가 상위 딜 가시성 기준으로 적용한다.
 */
export class SettlementsService {
  private get repo() {
    return getRepo();
  }

  /** 목록. dealId 를 주면 해당 딜의 정산만. */
  list(ctx: Ctx, opts: { dealId?: string } = {}): Settlement[] {
    const all = this.repo.listSettlements(ctx);
    return opts.dealId ? all.filter((s) => s.deal_id === opts.dealId) : all;
  }

  get(ctx: Ctx, id: string): Settlement | undefined {
    return this.repo.getSettlement(ctx, id);
  }

  getByDeal(ctx: Ctx, dealId: string): Settlement | undefined {
    return this.repo.getSettlementByDeal(ctx, dealId);
  }

  create(ctx: Ctx, input: NewSettlement): Settlement {
    return this.repo.createSettlement(ctx, input);
  }

  update(ctx: Ctx, id: string, patch: SettlementPatch): Settlement | undefined {
    return this.repo.updateSettlement(ctx, id, patch);
  }

  remove(ctx: Ctx, id: string): boolean {
    return this.repo.deleteSettlement(ctx, id);
  }

  /** 목록 + 집계를 함께 반환(대시보드/보드 헤더용). */
  listWithSummary(
    ctx: Ctx,
    opts: { dealId?: string } = {},
  ): { items: Settlement[]; summary: SettlementSummary } {
    const items = this.list(ctx, opts);
    return { items, summary: summarize(items) };
  }
}

/** 요청 처리용 서비스 인스턴스(공유 repo 사용). */
export function getSettlementsService(): SettlementsService {
  return new SettlementsService();
}
