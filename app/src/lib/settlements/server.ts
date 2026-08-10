import "server-only";
import type { Ctx } from "@/lib/types";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { assertWon, calculateTotals, toMinimalCsv, type LedgerEntry, type LedgerEntryKind } from "./ledger";

type SettlementRow = { id: string; fee_amount: number | string | null; total_revenue: number | string | null };
type EntryRow = { id: string; settlement_id: string; kind: LedgerEntryKind; amount: number | string; occurred_on: string; source: "input" | "calculated"; status: "posted" | "canceled"; corrected_from: string | null; created_at: string; created_by: string };
type SnapshotRow = SettlementRow & { entries: EntryRow[] | null };

const number = (value: number | string | null) => Number(value ?? 0);
const mapEntry = (row: EntryRow): LedgerEntry => ({ id: row.id, settlementId: row.settlement_id, kind: row.kind, amount: number(row.amount), occurredOn: row.occurred_on, source: row.source, status: row.status, correctedFrom: row.corrected_from, createdAt: row.created_at, createdBy: row.created_by });

export async function loadLedger(ctx: Ctx) {
  if (!hasSupabaseEnv()) return { available: false as const, rows: [] };
  const client = await createClient();
  const { data: settlements, error: settlementError } = await client.rpc("get_settlement_ledger_snapshot", { p_org_id: ctx.org.id });
  if (settlementError) throw new Error("정산 원장을 불러오지 못했어요.");
  const rows = Array.isArray(settlements) ? (settlements as SnapshotRow[]) : [];
  return { available: true as const, rows: rows.map((settlement) => { const own = (settlement.entries ?? []).map(mapEntry); const expected = number(settlement.fee_amount); return { settlementId: settlement.id, expected, totalRevenue: number(settlement.total_revenue), entries: own, totals: calculateTotals(expected, own) }; }) };
}

function requireManager(ctx: Ctx) {
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new Error("대표 또는 관리자만 정산을 변경할 수 있어요.");
}

export async function postEntry(ctx: Ctx, input: { settlementId: string; kind: LedgerEntryKind; amount: unknown; occurredOn: string }) {
  requireManager(ctx);
  const client = await createClient();
  const { error } = await client.rpc("post_settlement_ledger_entry", { p_settlement_id: input.settlementId, p_kind: input.kind, p_amount: assertWon(input.amount), p_occurred_on: input.occurredOn });
  if (error) throw new Error("정산 내역을 저장하지 못했어요.");
}

export async function cancelEntry(ctx: Ctx, entryId: string) {
  requireManager(ctx);
  const client = await createClient();
  const { error } = await client.rpc("cancel_settlement_ledger_entry", { p_entry_id: entryId });
  if (error) throw new Error("정산 내역을 취소하지 못했어요.");
}

export async function correctEntry(ctx: Ctx, input: { entryId: string; amount: unknown; occurredOn: string }) {
  requireManager(ctx);
  const client = await createClient();
  const { error } = await client.rpc("correct_settlement_ledger_entry", { p_entry_id: input.entryId, p_amount: assertWon(input.amount), p_occurred_on: input.occurredOn });
  if (error) throw new Error("정산 내역을 정정하지 못했어요.");
}

export async function exportLedgerCsv(ctx: Ctx) {
  requireManager(ctx);
  const snapshot = await loadLedger(ctx);
  if (!snapshot.available) throw new Error("정산 저장소가 아직 연결되지 않았어요.");
  const client = await createClient();
  const { error } = await client.rpc("record_settlement_csv_export", {
    p_org_id: ctx.org.id,
    p_row_count: snapshot.rows.length,
  });
  if (error) throw new Error("내보내기 감사 기록을 저장하지 못했어요.");
  return toMinimalCsv(snapshot.rows);
}
