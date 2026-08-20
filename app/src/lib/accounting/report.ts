/**
 * 정산 리포트 — 집계 순수 로직 (docs/design/정산-리포트-시안_v1.html §②).
 *
 * 총괄 승인 설계: **화면 리포트가 정본**이고 거기서 「인쇄(PDF 저장)」·「CSV」 두 갈래로만 나간다.
 * 그래서 필터·묶기·소계·합계가 전부 여기 한 곳에서 계산된다 — 화면과 CSV 가 «같은 수»를
 * 보게 하려면 계산이 한 벌이어야 하기 때문이다.
 *
 * 돈 규칙은 다시 구현하지 않는다. 매출 인식은 공급가(amount), 입금액은 실제 받은 전액,
 * 미수금은 entry 단위 `entryOutstanding()`(ledger.ts) — 순합계로 상쇄하지 않는다.
 *
 * ⚠ 이름 충돌 주의 — 원장의 `kind`(계약금/수수료)는 화면에서 **「수납구분」** 이라고 부른다.
 * 「구분」 은 2026-08-20 부터 계약업체 실무 보드의 다른 컬럼(자금/지원금/인증/기타용역)
 * 이름이다. 둘을 같은 낱말로 부르면 화면에서 섞인다.
 */

import { entryOutstanding, type LedgerKind } from "./ledger";
import type { YearlyLedgerRow } from "./yearly";

export interface LedgerReportRow {
  id: string;
  dealId: string;
  /** 업체 — `deals.title`. */
  companyName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** 계약업체 실무 보드 `institution` (진행기관). 못 읽으면 null. */
  institution: string | null;
  /** 보드 `fund_name` — 라벨은 «상품명칭». key 는 얼어 있다(contract-work.ts 참조). */
  fundName: string | null;
  /** 보드 `product` — 라벨은 «세부명칭». key 는 얼어 있다. */
  productName: string | null;
  kind: LedgerKind;
  amount: number;
  receivedAmount: number;
  occurredOn: string;
  paidOn: string | null;
  taxInvoiceIssued: boolean;
}

export const LEDGER_REPORT_GROUPINGS = ["company", "assignee", "month"] as const;
export type LedgerReportGrouping = (typeof LEDGER_REPORT_GROUPINGS)[number];

export const LEDGER_REPORT_GROUPING_LABEL: Readonly<Record<LedgerReportGrouping, string>> = {
  company: "업체별",
  assignee: "담당자별",
  month: "월별",
};

/** 합계 줄이 세는 단위 이름 — 「합계 — 2개 업체 · 수납 4건」. */
const GROUP_NOUN: Readonly<Record<LedgerReportGrouping, string>> = {
  company: "업체",
  assignee: "담당자",
  month: "월",
};

/** 원장 kind 의 화면 이름. 보드의 «구분» 과 다른 축이라 「수납구분」 이라고 부른다. */
export const LEDGER_KIND_LABEL: Readonly<Record<LedgerKind, string>> = {
  contract_deposit: "계약금",
  fee: "수수료",
};

/** 선택 안 함 = 전체. 빈 문자열 하나로 통일한다(select 의 기본 option value). */
export const LEDGER_REPORT_ALL = "";
/** 담당자가 비어 있는 행만 보기 — 빈 문자열은 이미 «전체» 라서 따로 표식이 필요하다. */
export const LEDGER_REPORT_UNASSIGNED = "__unassigned__";
/** 담당자 이름이 비면 화면에서 「미지정」. 빈 칸으로 두면 «있는데 안 보이는» 것과 구별이 안 된다. */
export const UNASSIGNED_LABEL = "미지정";

export interface LedgerReportFilter {
  /** "" 이면 아래로 열려 있다. */
  from: string;
  /** "" 이면 위로 열려 있다. */
  to: string;
  /** 업체명. "" = 전체. */
  company: string;
  /** 담당자 id, 또는 LEDGER_REPORT_UNASSIGNED. "" = 전체. */
  assignee: string;
  /** LedgerKind, "" = 전체. */
  kind: LedgerKind | "";
}

export const EMPTY_LEDGER_REPORT_FILTER: LedgerReportFilter = {
  from: LEDGER_REPORT_ALL,
  to: LEDGER_REPORT_ALL,
  company: LEDGER_REPORT_ALL,
  assignee: LEDGER_REPORT_ALL,
  kind: LEDGER_REPORT_ALL,
};

export interface LedgerReportTotals {
  /** 금액(공급가) 합. 매출 인식 기준. */
  amount: number;
  /** 입금액 합 — 부가세 포함이면 포함된 채 그대로. */
  received: number;
  /** entry 단위 max(0, amount-received) 의 합. */
  outstanding: number;
  rowCount: number;
}

export interface LedgerReportGroup {
  key: string;
  label: string;
  rows: readonly LedgerReportRow[];
  subtotal: LedgerReportTotals;
}

export interface LedgerReport {
  grouping: LedgerReportGrouping;
  groups: readonly LedgerReportGroup[];
  total: LedgerReportTotals;
  /** 「합계 — 2개 업체 · 수납 4건」. */
  totalLabel: string;
}

export interface LedgerReportOption {
  value: string;
  label: string;
}

function trimmed(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/**
 * 「상품명칭(세부명칭)」 — 세부명칭이 없으면 상품명칭만, 둘 다 없으면 null(빈 칸).
 *
 * 상품명칭만 비고 세부명칭이 있는 경우는 시안에 없다. 괄호만 남은 「(세부)」 를 그리지
 * 않고 세부명칭 하나만 보여준다 — 괄호는 «앞이 있을 때» 의 종속 표시이기 때문이다.
 */
export function ledgerProductLabel(row: Pick<LedgerReportRow, "fundName" | "productName">): string | null {
  const fund = trimmed(row.fundName);
  const detail = trimmed(row.productName);
  if (fund && detail) return `${fund}(${detail})`;
  return fund ?? detail;
}

function assigneeKey(row: LedgerReportRow): string {
  return row.assigneeId ?? LEDGER_REPORT_UNASSIGNED;
}

export function ledgerReportCompanyOptions(rows: readonly LedgerReportRow[]): LedgerReportOption[] {
  const names = new Set<string>();
  for (const row of rows) names.add(row.companyName);
  return Array.from(names)
    .sort((left, right) => left.localeCompare(right, "ko"))
    .map((name) => ({ value: name, label: name }));
}

export function ledgerReportAssigneeOptions(rows: readonly LedgerReportRow[]): LedgerReportOption[] {
  const byKey = new Map<string, string>();
  for (const row of rows) byKey.set(assigneeKey(row), row.assigneeName ?? UNASSIGNED_LABEL);
  return Array.from(byKey.entries())
    .sort((left, right) => left[1].localeCompare(right[1], "ko"))
    .map(([value, label]) => ({ value, label }));
}

/** 발생일 기준 기간 + 업체 + 담당자 + 수납구분. 빈 값은 전부 «전체» 다. */
export function filterLedgerReportRows(
  rows: readonly LedgerReportRow[],
  filter: LedgerReportFilter,
): readonly LedgerReportRow[] {
  return rows.filter((row) => {
    if (filter.from && row.occurredOn < filter.from) return false;
    if (filter.to && row.occurredOn > filter.to) return false;
    if (filter.company && row.companyName !== filter.company) return false;
    if (filter.assignee && assigneeKey(row) !== filter.assignee) return false;
    if (filter.kind && row.kind !== filter.kind) return false;
    return true;
  });
}

function totalsOf(rows: readonly LedgerReportRow[]): LedgerReportTotals {
  let amount = 0;
  let received = 0;
  let outstanding = 0;
  for (const row of rows) {
    amount += row.amount;
    received += row.receivedAmount;
    // ★ entry 단위로만 누적한다 — 부가세 초과입금 한 건이 다른 건의 진짜 미수금을
    //   순합계로 상쇄해 가리는 것을 막는다(ledger.ts 와 같은 규칙, 재구현 아님).
    outstanding += entryOutstanding(row);
  }
  return { amount, received, outstanding, rowCount: rows.length };
}

function groupKeyOf(row: LedgerReportRow, grouping: LedgerReportGrouping): string {
  if (grouping === "company") return row.companyName;
  if (grouping === "assignee") return assigneeKey(row);
  return row.occurredOn.slice(0, 7);
}

function groupLabelOf(row: LedgerReportRow, grouping: LedgerReportGrouping): string {
  if (grouping === "company") return row.companyName;
  if (grouping === "assignee") return row.assigneeName ?? UNASSIGNED_LABEL;
  const [year, month] = row.occurredOn.slice(0, 7).split("-");
  return `${year}년 ${Number(month)}월`;
}

/**
 * 필터 → 묶기 → 소계 → 합계. 화면과 CSV 가 이 하나만 쓴다.
 *
 * 그룹 순서: 월별은 키(yyyy-mm) 오름차순, 업체·담당자는 이름 가나다순.
 * 그룹 안 순서: 발생일 오름차순, 같으면 id 로 확정한다(출력이 매번 같아야 한다).
 */
export function buildLedgerReport(
  rows: readonly LedgerReportRow[],
  filter: LedgerReportFilter,
  grouping: LedgerReportGrouping,
): LedgerReport {
  const visible = filterLedgerReportRows(rows, filter);

  const buckets = new Map<string, { label: string; rows: LedgerReportRow[] }>();
  for (const row of visible) {
    const key = groupKeyOf(row, grouping);
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(row);
    else buckets.set(key, { label: groupLabelOf(row, grouping), rows: [row] });
  }

  const ordered = Array.from(buckets.entries()).sort(([leftKey, left], [rightKey, right]) =>
    grouping === "month"
      ? leftKey.localeCompare(rightKey)
      : left.label.localeCompare(right.label, "ko") || leftKey.localeCompare(rightKey),
  );

  const groups = ordered.map(([key, bucket]) => {
    const sorted = [...bucket.rows].sort(
      (left, right) => left.occurredOn.localeCompare(right.occurredOn) || left.id.localeCompare(right.id),
    );
    return { key, label: bucket.label, rows: sorted, subtotal: totalsOf(sorted) };
  });

  const total = totalsOf(visible);
  return {
    grouping,
    groups,
    total,
    totalLabel: `합계 — ${groups.length}개 ${GROUP_NOUN[grouping]} · 수납 ${total.rowCount}건`,
  };
}

/** 리포트 머리의 «조건» 한 줄 — 인쇄물만 보고도 무엇을 뽑았는지 알 수 있어야 한다. */
export function describeLedgerReportFilter(
  filter: LedgerReportFilter,
  labels: { company?: string | null; assignee?: string | null } = {},
): string {
  const period = filter.from || filter.to
    ? `${filter.from || "처음"} ~ ${filter.to || "오늘"}`
    : "전체 기간";
  const company = filter.company ? (labels.company ?? filter.company) : "전체 업체";
  const assignee = filter.assignee ? (labels.assignee ?? filter.assignee) : "전체 담당자";
  const kind = filter.kind ? LEDGER_KIND_LABEL[filter.kind] : "전체 수납구분";
  return [period, company, assignee, kind].join(" · ");
}

/** 연도별 원장 화면(기존 탭)이 쓰는 좁은 행으로 줄인다 — 조회를 두 번 하지 않기 위해서다. */
export function toYearlyLedgerRows(rows: readonly LedgerReportRow[]): YearlyLedgerRow[] {
  return rows.map((row) => ({
    id: row.id,
    dealId: row.dealId,
    dealTitle: row.companyName,
    assigneeName: row.assigneeName,
    kind: row.kind,
    amount: row.amount,
    receivedAmount: row.receivedAmount,
    occurredOn: row.occurredOn,
    paidOn: row.paidOn,
  }));
}
