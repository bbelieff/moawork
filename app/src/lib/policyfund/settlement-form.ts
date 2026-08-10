// T09 · 정산 수식 화면의 순수 로직 — 폼 입력 → 서버 요청 페이로드 / 표시값 추출.
//
// 컴포넌트(SettlementForm.tsx)에서 분리한 이유: 화면 재계산 금지(수용기준)를
// **테스트로 고정**하기 위해서다. 이 모듈은 산식을 갖지 않는다 — base 컬럼을
// 서버로 보내고, 서버가 돌려준 파생값을 표시용으로 추려낼 뿐이다.

import type { Settlement } from "@/lib/types";

/** 화면 입력값(문자열 그대로 — <input> 은 문자열을 준다). */
export interface SettlementFormFields {
  execAmount: string;
  feePct: string;
  downPayment: string;
  /** "" = 미입력 → null. */
  feePaidAt: string;
}

/** 서버로 보내는 생성 페이로드 — **base 컬럼만**. */
export interface SettlementCreatePayload {
  deal_id: string | null;
  exec_amount: number;
  fee_pct: number;
  down_payment: number;
  fee_paid_at: string | null;
}

/** 파생 컬럼 키 — 페이로드에 절대 포함되면 안 된다(서버가 400 거절). */
export const DERIVED_KEYS = [
  "fee_amount",
  "total_revenue",
  "d180",
  "d365",
] as const;

/** 빈 문자열/비수치 → 0 으로 수렴(서버가 최종 검증). */
function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 폼 입력 → 생성 페이로드. 파생값은 계산하지도, 담지도 않는다.
 * dealId 를 주면 해당 딜에 귀속시킨다.
 */
export function toCreatePayload(
  fields: SettlementFormFields,
  dealId: string | null = null,
): SettlementCreatePayload {
  return {
    deal_id: dealId,
    exec_amount: num(fields.execAmount),
    fee_pct: num(fields.feePct),
    down_payment: num(fields.downPayment),
    fee_paid_at: fields.feePaidAt === "" ? null : fields.feePaidAt,
  };
}

/** 화면이 표시하는 파생값 4종 — 서버 레코드에서 **그대로** 추린다. */
export interface DerivedDisplay {
  feeAmount: number;
  totalRevenue: number;
  d180: string | null;
  d365: string | null;
}

/**
 * 서버 응답 → 표시값. 산술 연산 없음(복사만).
 * 이것이 "화면 재계산 금지"의 구현: DB generated column 값이 그대로 화면에 간다.
 */
export function toDerivedDisplay(record: Settlement): DerivedDisplay {
  return {
    feeAmount: record.fee_amount,
    totalRevenue: record.total_revenue,
    d180: record.d180,
    d365: record.d365,
  };
}
