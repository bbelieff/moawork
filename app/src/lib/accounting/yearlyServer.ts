/**
 * 연도별 전체 원장 — 데이터 조회 (BBE-240 목업 ③).
 *
 * deal_ledger_entries 를 org 전체로 직접 조회한다 — 기존 can_access_deal_ledger 의
 * select 정책(딜 단위 RLS)이 org_id 필터 위에서도 그대로 자기-필터링하므로,
 * dash/aggregate.ts 처럼 딜 목록을 먼저 불러와 딜마다 루프 돌 필요가 없다.
 */

import { createClient } from "@/lib/supabase/server";
import { listOrgMemberOptions, toNameMap } from "@/lib/deal/members";
import type { Ctx } from "@/lib/types";
import type { LedgerKind } from "./ledger";
import { groupYearlyLedger, type YearlyLedgerRow, type YearlyLedgerYearGroup } from "./yearly";

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

function toRow(raw: Row, nameById: Map<string, string | null>): YearlyLedgerRow {
  const kind = raw.kind;
  if (kind !== "contract_deposit" && kind !== "fee") throw new YearlyLedgerReadError();
  const deal = dealJoinOf(raw.deals);
  const assignedTo = nullableString(deal.assigned_to);
  return {
    id: requiredString(raw.id),
    dealId: requiredString(raw.deal_id),
    dealTitle: requiredString(deal.title),
    assigneeName: assignedTo ? (nameById.get(assignedTo) ?? null) : null,
    kind: kind as LedgerKind,
    amount: won(raw.amount),
    receivedAmount: won(raw.received_amount),
    occurredOn: requiredString(raw.occurred_on),
    paidOn: nullableString(raw.paid_on),
  };
}

/** RLS 로만 접근 제한(can_access_deal_ledger 의 select 정책이 org_id 필터 위에서도 자기-필터링). */
export async function loadYearlyLedgerView(ctx: Ctx): Promise<readonly YearlyLedgerYearGroup[]> {
  const client = await createClient();
  const [entriesResult, members] = await Promise.all([
    client
      .from("deal_ledger_entries")
      .select("id,deal_id,kind,amount,received_amount,occurred_on,paid_on,deals(title,assigned_to)")
      .eq("org_id", ctx.org.id)
      .order("occurred_on", { ascending: true }),
    listOrgMemberOptions(ctx),
  ]);
  if (entriesResult.error || !Array.isArray(entriesResult.data)) throw new YearlyLedgerReadError();

  const nameById = toNameMap(members);
  const rows = (entriesResult.data as Row[]).map((raw) => toRow(raw, nameById));
  return groupYearlyLedger(rows);
}
