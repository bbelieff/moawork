// T04 · core.dash 집계 엔진(순수 함수).
//
// 입력은 모두 호출부가 주입한다(Repo 조회 결과) — 이 파일은 I/O 를 하지 않는다.
// 따라서 담당범위(assigned) 격리는 상위(@/lib/repo listDeals(ctx))에서 이미 적용된 채로 들어온다.
//
// 게이트 요건 대응(T10 §3-A):
//   - 전환율 분모/분자 정의 명확 + 0분모 방어  → ratio()/conversionRate()
//   - 기간 경계(월초/월말, KST)               → monthRangeKst()
//   - 데이터 0건일 때 0/'—'(NaN·에러 없음)     → 모든 집계가 빈 배열에서 0 반환, available 플래그
//   - 이중저장 없음(원본 파생)                 → 이 파일이 매 요청 계산

import type { Deal, FieldDef, Stage, StageKind } from "@/lib/types";
import { computeSettlement, type SettlementInput } from "@/lib/policyfund/settlement";
import type {
  ContractStatusBreakdown,
  ContractStatusCount,
  ConversionRate,
  DateRange,
  PipelineBreakdown,
  ReContactEntry,
  SettlementSummary,
  StageCount,
} from "./types";

/** KST(UTC+9) 오프셋. 월 경계 계산 기준. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 0분모 방어 비율. total<=0 이면 0. */
export function ratio(part: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return part / total;
}

/**
 * `YYYY-MM` 의 KST 기준 월 구간을 UTC ISO 반열린 구간 [start, end) 로 변환.
 * 예) 2026-07 (KST) → 2026-06-30T15:00:00.000Z ~ 2026-07-31T15:00:00.000Z
 */
export function monthRangeKst(yyyyMm: string): DateRange {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm);
  if (!m) throw new Error(`잘못된 월 형식(YYYY-MM): ${yyyyMm}`);
  const year = Number(m[1]);
  const month = Number(m[2]); // 1~12
  const startUtc = Date.UTC(year, month - 1, 1) - KST_OFFSET_MS;
  const endUtc = Date.UTC(year, month, 1) - KST_OFFSET_MS;
  return {
    start: new Date(startUtc).toISOString(),
    end: new Date(endUtc).toISOString(),
  };
}

/** 어떤 시각(ISO/날짜 문자열)이 구간 [start, end) 에 드는가. 파싱 불가면 false. */
export function inRange(value: string | null | undefined, range: DateRange): boolean {
  if (!value) return false;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(range.start) && t < Date.parse(range.end);
}

/** 지정 날짜 필드 기준으로 구간 내 딜만 남긴다. */
export function filterDealsByRange(
  deals: readonly Deal[],
  range: DateRange,
  pick: (d: Deal) => string | null = (d) => d.created_at,
): Deal[] {
  return deals.filter((d) => inRange(pick(d), range));
}

/**
 * 단계별 건수 집계. 빈 단계도 결과에 포함하며 sort_order 오름차순으로 정렬한다.
 * 단계 미지정(stage_id=null 또는 미지 단계) 딜은 unassigned 로 분리.
 */
export function pipelineBreakdown(
  deals: readonly Deal[],
  stages: readonly Stage[],
): PipelineBreakdown {
  const ordered = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const counts = new Map<string, number>();
  let unassigned = 0;

  const known = new Set(ordered.map((s) => s.id));
  for (const d of deals) {
    if (d.stage_id && known.has(d.stage_id)) {
      counts.set(d.stage_id, (counts.get(d.stage_id) ?? 0) + 1);
    } else {
      unassigned += 1;
    }
  }

  const total = deals.length;
  const stageCounts: StageCount[] = ordered.map((s) => {
    const count = counts.get(s.id) ?? 0;
    return {
      stageId: s.id,
      name: s.name,
      kind: s.kind,
      sortOrder: s.sort_order,
      count,
      ratio: ratio(count, total),
    };
  });

  return { total, unassigned, stages: stageCounts };
}

/**
 * 특정 종류(kind)의 **첫 단계 이상**에 도달한 딜 수.
 * 도달 기준 = 딜의 현재 단계 sort_order >= 해당 kind 첫 단계의 sort_order.
 * 해당 kind 의 단계가 없으면 0.
 */
export function reachedKind(
  deals: readonly Deal[],
  stages: readonly Stage[],
  kind: StageKind,
): number {
  const thresholds = stages.filter((s) => s.kind === kind).map((s) => s.sort_order);
  if (thresholds.length === 0) return 0;
  const threshold = Math.min(...thresholds);
  const orderById = new Map(stages.map((s) => [s.id, s.sort_order]));
  return deals.reduce((n, d) => {
    const order = d.stage_id ? orderById.get(d.stage_id) : undefined;
    return order !== undefined && order >= threshold ? n + 1 : n;
  }, 0);
}

/**
 * 전환율 — 분모=전체 딜, 분자=kind 첫 단계 이상 도달 딜. 0분모 방어.
 */
export function conversionRate(
  deals: readonly Deal[],
  stages: readonly Stage[],
  kind: StageKind,
): ConversionRate {
  const reached = reachedKind(deals, stages, kind);
  const total = deals.length;
  return { kind, reached, total, rate: ratio(reached, total) };
}

/** 딜 금액(amount) 합계. null 은 0 취급. */
export function sumAmounts(deals: readonly Deal[]): number {
  return deals.reduce((sum, d) => sum + (typeof d.amount === "number" ? d.amount : 0), 0);
}

/**
 * 정책자금 프리셋(ind.policyfund)이 등록하는 딜 커스텀필드 **key**.
 *
 * ⚠ BUG-0002: key 는 **영문 식별자**이고 한글은 `label` 이다. 초기 구현이 라벨을
 *   key 로 써서 계약상황 위젯이 항상 미가용으로 떨어지고, 정산 추출도 아무것도
 *   매칭하지 못했다(→ 항상 '임시 추정' 폴백). 하드코딩 대신 이 상수만 참조한다.
 *
 * 출처: lib/presets/policyfund.ts (설치 시 field_defs 로 전개).
 * 정합은 aggregate.test.ts 의 가드 테스트가 실제 프리셋을 설치해 검증한다.
 */
export const POLICYFUND_FIELD_KEYS = {
  contractStatus: "contract_status",
  execAmount: "exec_amount",
  feePct: "fee_pct",
  feePaidAt: "fee_paid_at",
  /** 계약금 — settlements 엔티티에는 있으나 프리셋 커스텀필드로는 미정의(없으면 0 보정). */
  downPayment: "down_payment",
} as const;

/**
 * 계약상황 분포 — field_defs 의 select 필드(기본 key: `contract_status`) 옵션별 건수.
 * 딜의 값은 `deal.custom[fieldKey]` 에서 읽고, 옵션 id 우선·라벨 폴백으로 매칭한다.
 * 필드 정의가 없으면 available=false (화면은 '—').
 */
export function contractStatusBreakdown(
  deals: readonly Deal[],
  fieldDefs: readonly FieldDef[],
  fieldKey: string = POLICYFUND_FIELD_KEYS.contractStatus,
): ContractStatusBreakdown {
  const def = fieldDefs.find((f) => f.entity === "deal" && f.key === fieldKey);
  const total = deals.length;

  if (!def || !def.options_jsonb) {
    return { available: false, fieldKey: null, total, unset: total, options: [] };
  }

  const options = def.options_jsonb.options.filter((o) => !o.archived);
  const byId = new Map(options.map((o) => [o.id, o.id]));
  const byLabel = new Map(options.map((o) => [o.label, o.id]));

  const counts = new Map<string, number>(options.map((o) => [o.id, 0]));
  let unset = 0;

  for (const d of deals) {
    const raw = d.custom?.[def.key];
    const key = typeof raw === "string" ? (byId.get(raw) ?? byLabel.get(raw)) : undefined;
    if (key === undefined) {
      unset += 1;
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result: ContractStatusCount[] = options.map((o) => {
    const count = counts.get(o.id) ?? 0;
    return { optionId: o.id, label: o.label, count, ratio: ratio(count, total) };
  });

  return { available: true, fieldKey: def.key, total, unset, options: result };
}

// ── 정산 요약 (수식 = T09 확정본 소비, 재저작 금지) ────────────────────

/** 딜 커스텀필드에서 정산 입력을 읽는 키 맵. 확정 시 호출부가 주입. */
export interface SettlementFieldKeys {
  /** 실행액 */
  disbursedAmount: string;
  /** 수수료율(정수 %) */
  feePercent: string;
  /** 계약금 */
  downPayment: string;
  /** 수수료 입금일 */
  feeDepositDate: string;
}

/**
 * 딜 커스텀필드에서 정산 입력을 읽는 기본 키.
 * ⚠ BUG-0002 로 한글 라벨 → 영문 key 로 교정. settlements 엔티티 컬럼명과도 동일하다
 *   (down_payment / exec_amount / fee_pct / fee_paid_at) — 실측 원천 교체 시 그대로 대응.
 */
export const DEFAULT_SETTLEMENT_KEYS: SettlementFieldKeys = {
  disbursedAmount: POLICYFUND_FIELD_KEYS.execAmount,
  feePercent: POLICYFUND_FIELD_KEYS.feePct,
  downPayment: POLICYFUND_FIELD_KEYS.downPayment,
  feeDepositDate: POLICYFUND_FIELD_KEYS.feePaidAt,
};

/** 셀 값을 유한수로 강제. 콤마·통화기호 허용. 불가면 null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.replace(/[,\s₩]/g, "");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 셀 값을 Date 로 강제. 불가면 null. */
export function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * 딜에서 정산 입력을 추출한다.
 * 실행액·수수료율·계약금이 모두 수치로 읽히는 딜만 대상(불완전 건 제외).
 */
export function toSettlementInputs(
  deals: readonly Deal[],
  keys: SettlementFieldKeys = DEFAULT_SETTLEMENT_KEYS,
): { deal: Deal; input: SettlementInput }[] {
  const out: { deal: Deal; input: SettlementInput }[] = [];
  for (const d of deals) {
    const disbursedAmount = toNumber(d.custom?.[keys.disbursedAmount]);
    const feePercent = toNumber(d.custom?.[keys.feePercent]);
    const downPayment = toNumber(d.custom?.[keys.downPayment]) ?? 0;
    if (disbursedAmount === null || feePercent === null) continue;
    out.push({
      deal: d,
      input: {
        disbursedAmount,
        feePercent,
        downPayment,
        feeDepositDate: toDate(d.custom?.[keys.feeDepositDate]),
      },
    });
  }
  return out;
}

/** 정산 요약 — 수수료·총매출 합계. 입력이 없으면 available=false. */
export function settlementSummary(
  entries: readonly { input: SettlementInput }[],
): SettlementSummary {
  if (entries.length === 0) {
    return {
      available: false,
      provisional: false,
      count: 0,
      downPaymentSum: 0,
      feeSum: 0,
      totalRevenueSum: 0,
    };
  }
  let downPaymentSum = 0;
  let feeSum = 0;
  let totalRevenueSum = 0;
  for (const { input } of entries) {
    const r = computeSettlement(input);
    downPaymentSum += input.downPayment;
    feeSum += r.feeAmount;
    totalRevenueSum += r.totalRevenue;
  }
  return {
    available: true,
    provisional: false,
    count: entries.length,
    downPaymentSum,
    feeSum,
    totalRevenueSum,
  };
}

/**
 * 정산 **임시** 추정 — `deal.amount` 합계를 총매출로 간주한다.
 *
 * TODO(T04): settlements 원천이 붙으면 제거하고 settlementSummary() 로 일원화할 것.
 *   현재 001 의 settlements(실행액·수수료%·계약금·수수료입금일)가 @/lib/repo 포트에
 *   노출되지 않아 정확 계산이 불가하다. 순서(기획2 합의): T03 이 포트 인터페이스에
 *   settlements 를 선행 추가 → T09 가 구현 → T04 가 임시→실측 교체.
 *   그때까지 '—' 대신 amount 기반 근사치를 보여주되 화면에 "임시"를 반드시 표기한다.
 *   ⚠ 수수료·계약금은 산출 불가라 0 이다(총매출만 근사).
 */
export function provisionalSettlementFromAmounts(
  deals: readonly Deal[],
): SettlementSummary {
  const withAmount = deals.filter(
    (d) => typeof d.amount === "number" && Number.isFinite(d.amount),
  );
  if (withAmount.length === 0) {
    return {
      available: false,
      provisional: true,
      count: 0,
      downPaymentSum: 0,
      feeSum: 0,
      totalRevenueSum: 0,
    };
  }
  return {
    available: true,
    provisional: true,
    count: withAmount.length,
    downPaymentSum: 0,
    feeSum: 0,
    totalRevenueSum: sumAmounts(withAmount),
  };
}

/**
 * 정산 요약을 만들되, 정산 원천이 없으면 deal.amount 기반 임시 추정으로 폴백한다.
 * (기획2 피드백: '—' 대신 임시 계산을 노출)
 */
export function settlementSummaryOrProvisional(
  entries: readonly { input: SettlementInput }[],
  fallbackDeals: readonly Deal[],
): SettlementSummary {
  const exact = settlementSummary(entries);
  if (exact.available) return exact;
  return provisionalSettlementFromAmounts(fallbackDeals);
}

/**
 * 재접촉(D+180 / D+365) 목록.
 * 수수료입금일이 없는 건은 D+n 이 null 이며 기본적으로 제외한다(includeUndated=true 면 포함).
 */
export function reContactList(
  entries: readonly { deal: Deal; input: SettlementInput }[],
  includeUndated = false,
): ReContactEntry[] {
  const out: ReContactEntry[] = [];
  for (const { deal, input } of entries) {
    const r = computeSettlement(input);
    if (r.dPlus180 === null && !includeUndated) continue;
    out.push({
      dealId: deal.id,
      title: deal.title,
      dPlus180: r.dPlus180,
      dPlus365: r.dPlus365,
    });
  }
  return out;
}

/** 재접촉 대상 중 지정 구간에 해당하는 건만. */
export function reContactDue(
  entries: readonly ReContactEntry[],
  range: DateRange,
  which: "dPlus180" | "dPlus365" = "dPlus180",
): ReContactEntry[] {
  return entries.filter((e) => inRange(e[which], range));
}
