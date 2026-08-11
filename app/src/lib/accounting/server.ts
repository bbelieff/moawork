import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { DealLedgerEntry } from "./ledger";

type LedgerRow = Readonly<{
  id: unknown;
  deal_id: unknown;
  kind: unknown;
  amount: unknown;
  received_amount: unknown;
  occurred_on: unknown;
  paid_on: unknown;
  attribution_month: unknown;
}>;

type LedgerSummaryRow = Readonly<{
  deal_id: unknown;
  fee_total: unknown;
}>;

export type DealLedgerReadModel = Readonly<{
  entries: readonly DealLedgerEntry[];
  expectedFeeTotal: number;
}>;

export class DealLedgerReadError extends Error {
  constructor() {
    super("deal ledger could not be loaded");
    this.name = "DealLedgerReadError";
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new DealLedgerReadError();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function won(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new DealLedgerReadError();
  }
  const text = String(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) throw new DealLedgerReadError();
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new DealLedgerReadError();
  return parsed;
}

function ledgerEntry(row: LedgerRow, requestedDealId: string): DealLedgerEntry {
  const dealId = requiredString(row.deal_id);
  if (dealId !== requestedDealId) throw new DealLedgerReadError();
  if (row.kind !== "contract_deposit" && row.kind !== "fee") {
    throw new DealLedgerReadError();
  }
  const amount = won(row.amount);
  const receivedAmount = won(row.received_amount);
  if (receivedAmount > amount) throw new DealLedgerReadError();

  return {
    id: requiredString(row.id),
    dealId,
    kind: row.kind,
    amount,
    receivedAmount,
    occurredOn: requiredString(row.occurred_on),
    paidOn: nullableString(row.paid_on),
    attributionMonth: requiredString(row.attribution_month),
  };
}

/** Reads the current session's RLS-scoped ledger without service-role privileges. */
export async function loadDealLedger(
  dealId: string,
  clientFactory: () => Promise<SupabaseClient> = createClient,
): Promise<DealLedgerReadModel> {
  requiredString(dealId);
  const client = await clientFactory();
  const accessResult = await client.rpc("can_access_deal_ledger", { p_deal_id: dealId });
  if (accessResult.error || accessResult.data !== true) throw new DealLedgerReadError();

  const rowsResult = await client
    .from("deal_ledger_entries")
    .select("id,deal_id,kind,amount,received_amount,occurred_on,paid_on,attribution_month")
    .eq("deal_id", dealId)
    .order("occurred_on", { ascending: true });

  if (rowsResult.error || !Array.isArray(rowsResult.data)) throw new DealLedgerReadError();

  const summaryResult = await client.rpc("deal_ledger_summary", { p_deal_id: dealId });
  if (summaryResult.error || !Array.isArray(summaryResult.data) || summaryResult.data.length !== 1) {
    throw new DealLedgerReadError();
  }

  const summary = summaryResult.data[0] as LedgerSummaryRow;
  if (requiredString(summary.deal_id) !== dealId) throw new DealLedgerReadError();

  return {
    entries: (rowsResult.data as LedgerRow[]).map((row) => ledgerEntry(row, dealId)),
    expectedFeeTotal: won(summary.fee_total),
  };
}
