"use server";

/**
 * 원장 팝업(보드 행 · /deals/[dealId] 공용) 서버 액션 (BBE-240).
 *
 * 팝업 열림 시점에 원장 항목과 계약조건(fee_terms)을 한 번에 읽고, 입력은 035 의
 * `add_deal_ledger_entry` RPC(103 에서 vat_included/tax_invoice_issued 두 인자 추가)로만 쓴다.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadDealLedger, DealLedgerReadError } from "./server";
import type { DealLedgerEntry, LedgerKind } from "./ledger";

export type LedgerPopupState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "error" }>
  | Readonly<{
      kind: "ready";
      entries: readonly DealLedgerEntry[];
      expectedFeeTotal: number;
      feeTerms: string | null;
    }>;

export async function loadDealLedgerAction(dealId: string): Promise<LedgerPopupState> {
  try {
    const model = await loadDealLedger(dealId);

    // RLS 가 이미 호출자의 org/딜 접근권으로 이 읽기를 제한한다 — 추가 권한 검사 불필요.
    const client = await createClient();
    const { data } = await client.from("deals").select("fee_terms").eq("id", dealId).maybeSingle();
    const feeTerms = typeof data?.fee_terms === "string" ? data.fee_terms : null;

    return { kind: "ready", entries: model.entries, expectedFeeTotal: model.expectedFeeTotal, feeTerms };
  } catch (error) {
    if (error instanceof DealLedgerReadError) return { kind: "error" };
    throw error;
  }
}

export type AddLedgerEntryInput = Readonly<{
  dealId: string;
  kind: LedgerKind;
  amount: number;
  receivedAmount: number;
  occurredOn: string; // "yyyy-mm-dd"
  paidOn: string | null;
  vatIncluded: boolean;
  taxInvoiceIssued: boolean;
}>;

export type AddLedgerEntryResult = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>;

export async function addDealLedgerEntryAction(input: AddLedgerEntryInput): Promise<AddLedgerEntryResult> {
  const client = await createClient();
  // attribution_month 는 언제나 발생일(occurredOn)의 달에서 서버가 파생한다 — 클라이언트
  // 값을 신뢰하지 않는다(035 의 `date_trunc('month', attribution_month)` 불변식과 일치).
  const attributionMonth = `${input.occurredOn.slice(0, 7)}-01`;

  const { error } = await client.rpc("add_deal_ledger_entry", {
    p_deal_id: input.dealId,
    p_kind: input.kind,
    p_amount: input.amount,
    p_received_amount: input.receivedAmount,
    p_occurred_on: input.occurredOn,
    p_paid_on: input.paidOn,
    p_attribution_month: attributionMonth,
    p_vat_included: input.vatIncluded,
    p_tax_invoice_issued: input.taxInvoiceIssued,
  });

  if (error) return { ok: false, message: "원장에 저장하지 못했어요. 값을 다시 확인해 주세요." };

  // 보드 행 팝업은 페이지 라우트에 묶여 있지 않아 호출부가 loadDealLedgerAction 을
  // 재호출해 새로고침한다. /deals/[dealId] 만 덤으로 덕을 본다(있으면 좋고 없어도 무해).
  revalidatePath(`/deals/${input.dealId}`);
  return { ok: true };
}

/**
 * QA #885 (belie 2026-10-13 «원장 고치기·지우기») — migration 174 의 RPC 로만 쓴다.
 *   고치기: 원장 접근권 + 항목 추가·수정 권한. 지우기: 원장 접근권 + (본인이 넣은 항목 또는 항목 삭제 권한).
 *   지우기는 «지운 표시» 라 합계에서 빠지고, 딜 활동 기록에 무엇을 지웠는지 남는다.
 */
export type UpdateLedgerEntryInput = Readonly<{
  entryId: string;
  dealId: string;
  amount: number;
  receivedAmount: number;
  occurredOn: string;
  paidOn: string | null;
  vatIncluded: boolean;
  taxInvoiceIssued: boolean;
}>;

function ledgerWriteMessage(code: string | undefined, verb: "고치" | "지우"): string {
  if (code === "42501") {
    return verb === "고치"
      ? "원장을 고칠 권한이 없어요. 항목 수정 권한이 있는지 관리자에게 확인해 주세요."
      : "이 항목을 지울 권한이 없어요. 직접 넣은 항목이거나 항목 삭제 권한이 있어야 해요.";
  }
  if (code === "P0002") return "이미 지워졌거나 찾을 수 없는 항목이에요. 원장을 새로 불러와 주세요.";
  return verb === "고치" ? "원장을 고치지 못했어요. 값을 다시 확인해 주세요." : "원장 항목을 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

export async function updateDealLedgerEntryAction(input: UpdateLedgerEntryInput): Promise<AddLedgerEntryResult> {
  const client = await createClient();
  const { error } = await client.rpc("update_deal_ledger_entry", {
    p_entry_id: input.entryId,
    p_amount: input.amount,
    p_received_amount: input.receivedAmount,
    p_occurred_on: input.occurredOn,
    p_paid_on: input.paidOn,
    p_vat_included: input.vatIncluded,
    p_tax_invoice_issued: input.taxInvoiceIssued,
  });
  if (error) return { ok: false, message: ledgerWriteMessage(error.code, "고치") };
  revalidatePath(`/deals/${input.dealId}`);
  return { ok: true };
}

export async function deleteDealLedgerEntryAction(input: Readonly<{ entryId: string; dealId: string }>): Promise<AddLedgerEntryResult> {
  const client = await createClient();
  const { error } = await client.rpc("delete_deal_ledger_entry", { p_entry_id: input.entryId });
  if (error) return { ok: false, message: ledgerWriteMessage(error.code, "지우") };
  revalidatePath(`/deals/${input.dealId}`);
  return { ok: true };
}
