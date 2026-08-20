/**
 * /ledger 화면의 데이터 조회 — 연도별 원장(BBE-240 목업 ③) + 정산 리포트(시안 v1 §②).
 *
 * deal_ledger_entries 를 org 전체로 직접 조회한다 — 기존 can_access_deal_ledger 의
 * select 정책(딜 단위 RLS)이 org_id 필터 위에서도 그대로 자기-필터링하므로,
 * dash/aggregate.ts 처럼 딜 목록을 먼저 불러와 딜마다 루프 돌 필요가 없다.
 *
 * 한 번만 읽는다. 두 화면(연도별 탭 · 리포트 탭)이 같은 행에서 갈라져 나오므로
 * 원장 조회를 두 벌 돌리지 않는다 — 같은 페이지에서 같은 표를 두 번 훑는 낭비다.
 *
 * 엄격함의 경계: **원장과 딜은 리포트의 본문**이라 형태가 어긋나면 YearlyLedgerReadError
 * 로 던진다. 반면 보드에서 오는 진행기관·상품명칭·세부명칭은 «장식» 이라 절대 던지지
 * 않는다(boardValues.ts). 그 셋 때문에 화면 전체가 오류문으로 바뀌면 안 되기 때문이다.
 */

import { createClient } from "@/lib/supabase/server";
import { listOrgMemberOptions, toNameMap } from "@/lib/deal/members";
import type { Ctx } from "@/lib/types";
import { EMPTY_CONTRACT_WORK_VALUES, loadContractWorkDealValues, type ContractWorkDealValues } from "./boardValues";
import type { LedgerKind } from "./ledger";
import type { LedgerReportRow } from "./report";
import { toYearlyLedgerRows } from "./report";
import { groupYearlyLedger, type YearlyLedgerYearGroup } from "./yearly";

export class YearlyLedgerReadError extends Error {
  constructor() {
    super("yearly ledger could not be loaded");
    this.name = "YearlyLedgerReadError";
  }
}

type Row = Readonly<{
  id: unknown;
  deal_id: unknown;
  kind: unknown;
  amount: unknown;
  received_amount: unknown;
  occurred_on: unknown;
  paid_on: unknown;
  tax_invoice_issued: unknown;
  deals: unknown;
}>;

type DealJoin = { title: unknown; assigned_to: unknown };

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new YearlyLedgerReadError();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

function won(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw new YearlyLedgerReadError();
  const text = String(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) throw new YearlyLedgerReadError();
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new YearlyLedgerReadError();
  return parsed;
}

function dealJoinOf(value: unknown): DealJoin {
  const row = Array.isArray(value) ? value[0] : value;
  if (typeof row !== "object" || row === null) throw new YearlyLedgerReadError();
  return row as DealJoin;
}

function toRow(
  raw: Row,
  nameById: Map<string, string | null>,
  boardValues: Map<string, ContractWorkDealValues>,
): LedgerReportRow {
  const kind = raw.kind;
  if (kind !== "contract_deposit" && kind !== "fee") throw new YearlyLedgerReadError();
  const deal = dealJoinOf(raw.deals);
  const assignedTo = nullableString(deal.assigned_to);
  const dealId = requiredString(raw.deal_id);
  const board = boardValues.get(dealId) ?? EMPTY_CONTRACT_WORK_VALUES;
  return {
    id: requiredString(raw.id),
    dealId,
    companyName: requiredString(deal.title),
    assigneeId: assignedTo,
    assigneeName: assignedTo ? (nameById.get(assignedTo) ?? null) : null,
    institution: board.institution,
    fundName: board.fundName,
    productName: board.productName,
    kind: kind as LedgerKind,
    amount: won(raw.amount),
    receivedAmount: won(raw.received_amount),
    occurredOn: requiredString(raw.occurred_on),
    paidOn: nullableString(raw.paid_on),
    // 103 이 not null default false 로 붙인 열이라 boolean 이 아니면 «미발행» 으로 읽는다.
    taxInvoiceIssued: raw.tax_invoice_issued === true,
  };
}

export interface LedgerScreenData {
  /** 연도별 원장 탭(기존 화면). */
  years: readonly YearlyLedgerYearGroup[];
  /** 정산 리포트 탭 — 필터·묶기는 클라이언트에서 이 행들 위에 건다. */
  rows: readonly LedgerReportRow[];
}

/** RLS 로만 접근 제한(can_access_deal_ledger 의 select 정책이 org_id 필터 위에서도 자기-필터링). */
export async function loadLedgerScreen(ctx: Ctx): Promise<LedgerScreenData> {
  const client = await createClient();
  const [entriesResult, members, boardValues] = await Promise.all([
    client
      .from("deal_ledger_entries")
      .select("id,deal_id,kind,amount,received_amount,occurred_on,paid_on,tax_invoice_issued,deals(title,assigned_to)")
      .eq("org_id", ctx.org.id)
      .order("occurred_on", { ascending: true }),
    listOrgMemberOptions(ctx),
    loadContractWorkDealValues(ctx),
  ]);
  if (entriesResult.error || !Array.isArray(entriesResult.data)) throw new YearlyLedgerReadError();

  const nameById = toNameMap(members);
  const rows = (entriesResult.data as Row[]).map((raw) => toRow(raw, nameById, boardValues));
  return { years: groupYearlyLedger(toYearlyLedgerRows(rows)), rows };
}
