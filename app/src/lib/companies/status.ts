import type { DealLedgerEntry } from "@/lib/accounting/ledger";
import { entryOutstanding } from "@/lib/accounting/ledger";

/**
 * 「업체관리 현황」 표의 열 정의 — **목업이 기준이다**
 * (docs/design/UI목업_워크스페이스_최종_v6.html, T.company).
 *
 * 이 배열이 화면의 «배치 계약» 이다. 순서가 곧 목업의 좌→우 순서이고,
 * 렌더 테스트가 이 순서대로 실제 HTML 에 나오는지를 잰다.
 * 열을 넣고 빼거나 순서를 바꾸는 것은 곧 목업과의 차이를 만드는 일이라
 * 여기서만 하고, 근거를 주석으로 남긴다.
 */
export const COMPANY_STATUS_COLUMNS = [
  { key: "company_fund", label: "회사 · 자금명", align: "left" },
  { key: "institution", label: "진행기관", align: "left" },
  { key: "owner", label: "담당자", align: "left" },
  { key: "status", label: "상태", align: "left" },
  { key: "started_on", label: "착수", align: "left" },
  { key: "approved_on", label: "승인", align: "left" },
  { key: "execution_amount", label: "실행액", align: "right" },
  // ★ 목업은 이 자리가 «수수료율»(숫자 %) 이다. 2026-08-24 총괄 직접 지시로 «계약조건»(자유기재)
  //   으로 바꾼다 — CLAUDE.md 「기준의 우선순위」 1번(총괄 직접 지시)이 2번(목업)을 이긴다.
  //   근거: 「수수료 %는 앞으로 변동이 생길 수 있는 이슈야. 그래서 수수료 개념을 굳이 %로 하기보다는
  //   원래 %가 있던 계약조건을 빈필드로 놔두고 자유기재할 수 있도록 해줘」
  //   저장 위치는 이미 있다 — `deals.fee_terms`(마이그레이션 105_bbe240).
  //   → 목업과의 «영구 차이» 1건. 고객 고유값이 아니라 제품 결정이라 목업을 따라가지 않는다.
  { key: "fee_terms", label: "계약조건", align: "left" },
  { key: "contract_deposit", label: "계약금", align: "right" },
  { key: "contract_deposit_paid_on", label: "계약금 수납", align: "left" },
  { key: "fee", label: "수수료", align: "right" },
  { key: "fee_billed_on", label: "수수료 청구", align: "left" },
  { key: "fee_paid_on", label: "수수료 수납", align: "left" },
] as const;

export type CompanyStatusColumnKey = (typeof COMPANY_STATUS_COLUMNS)[number]["key"];

/**
 * 한 자금 건의 «돈» 부분. 목업의 부제가 못박아 둔 대로 **금액은 원장이 정본**이다
 * ("회사 1행 · 펼치면 자금 건별 이력 · 금액은 원장 합계").
 * 그래서 계약금·수수료·수납일을 딜이나 보드가 아니라 원장 entry 에서 뽑는다.
 */
export interface DealMoneyView {
  contractDeposit: number | null;
  contractDepositPaidOn: string | null;
  fee: number | null;
  /** 수수료 «청구» — 원장 entry 의 발생일(occurredOn). 수납일(paidOn) 과 다른 사실이다. */
  feeBilledOn: string | null;
  feePaidOn: string | null;
  ledgerTotal: number;
  outstanding: number;
}

/**
 * 원장 entry 들을 표 한 줄이 필요로 하는 모양으로 접는다.
 *
 * ★ 미수금은 반드시 entry 단위로 더한다(`entryOutstanding`). 순합계로 빼면
 *   부가세 초과입금 한 건이 다른 건의 진짜 미수금을 «0원» 으로 가린다.
 * ★ 건이 하나도 없는 종류는 0원이 아니라 **null** 이다 — 「아직 없다」와 「0원이다」는
 *   다른 사실이고, 화면은 전자를 «—» 로 그려야 한다.
 */
export function summarizeDealMoney(entries: readonly DealLedgerEntry[]): DealMoneyView {
  const deposits = entries.filter((entry) => entry.kind === "contract_deposit");
  const fees = entries.filter((entry) => entry.kind === "fee");
  const sum = (rows: readonly DealLedgerEntry[]) => rows.reduce((total, row) => total + row.amount, 0);

  return {
    contractDeposit: deposits.length ? sum(deposits) : null,
    // 여러 건이면 «마지막으로 들어온 날» 이 그 건의 수납 상태를 말해 준다.
    contractDepositPaidOn: latestDate(deposits.map((entry) => entry.paidOn)),
    fee: fees.length ? sum(fees) : null,
    feeBilledOn: latestDate(fees.map((entry) => entry.occurredOn)),
    feePaidOn: latestDate(fees.map((entry) => entry.paidOn)),
    ledgerTotal: sum(entries),
    outstanding: entries.reduce((total, entry) => total + entryOutstanding(entry), 0),
  };
}

function latestDate(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  if (present.length === 0) return null;
  return present.reduce((latest, value) => (value > latest ? value : latest));
}

/** 화면 위 KPI 5개. 목업의 `.kpis` 그리드와 같은 순서·같은 뜻이다. */
export interface CompanyStatusTotals {
  companyCount: number;
  dealCount: number;
  executionTotal: number;
  feeTotal: number;
  outstandingTotal: number;
}

/**
 * KPI 합계.
 *
 * ★ «누적 실행액» 은 원장 합계가 아니라 **딜의 실행액**(deals.amount) 을 더한 것이다.
 *   원장에는 계약금·수수료가 들어 있어서, 원장 합계를 실행액이라 부르면 숫자가 부풀어 오른다.
 *   목업의 `T0.exec` 도 실행액(`d.exec`) 을 따로 더한다.
 */
export function totalsFrom(
  companies: readonly Readonly<{ deals: readonly Readonly<{ executionAmount: number | null; money: DealMoneyView }>[] }>[],
): CompanyStatusTotals {
  let dealCount = 0;
  let executionTotal = 0;
  let feeTotal = 0;
  let outstandingTotal = 0;

  for (const company of companies) {
    for (const deal of company.deals) {
      dealCount += 1;
      executionTotal += deal.executionAmount ?? 0;
      feeTotal += deal.money.fee ?? 0;
      outstandingTotal += deal.money.outstanding;
    }
  }

  return {
    companyCount: companies.length,
    dealCount,
    executionTotal,
    feeTotal,
    outstandingTotal,
  };
}
