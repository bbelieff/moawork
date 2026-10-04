"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createClient } from "@/lib/supabase/server";
import {
  VAT_PERIOD_RPC,
  normalizeVatPeriodConfirmation,
  parseVatPeriodSnapshot,
  type VatPeriodConfirmationInput,
  type VatPeriodSnapshot,
} from "@/lib/document-ocr/vat-period-persistence";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VatPeriodActionErrorCode =
  | "conflict"
  | "permission"
  | "request_mismatch"
  | "unavailable";

export type VatPeriodActionResult =
  | Readonly<{ ok: true; data: VatPeriodSnapshot; message: string }>
  | Readonly<{ ok: false; code: VatPeriodActionErrorCode; error: string }>;

export type VatPeriodTarget = Readonly<{ boardId: string; itemId: string }>;

export type ConfirmVatPeriodsInput = VatPeriodTarget & Readonly<{
  requestId: string;
  expectedVersion: number;
  confirmation: VatPeriodConfirmationInput;
}>;

function validTarget(input: VatPeriodTarget): boolean {
  return UUID.test(input.boardId) && UUID.test(input.itemId);
}

function databaseCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function failure(error: unknown, read: boolean): VatPeriodActionResult {
  const code = databaseCode(error);
  if (code === "40001") {
    return { ok: false, code: "conflict", error: "기간별 자료가 먼저 변경되었습니다. 새로 불러온 뒤 같은 파일로 다시 확인해 주세요." };
  }
  if (code === "42501") {
    return { ok: false, code: "permission", error: read ? "이 기간별 자료를 볼 수 없습니다." : "이 기간별 자료를 저장할 권한이 없습니다." };
  }
  if (code === "22023" || code === "23505") {
    return { ok: false, code: "request_mismatch", error: "첨부 파일·사업자번호·기간 자료가 현재 회사 정보와 맞지 않습니다." };
  }
  return {
    ok: false,
    code: "unavailable",
    error: read
      ? "저장된 기간별 자료를 불러오지 못했습니다. 첨부 파일은 그대로 보존되어 있습니다."
      : "기간별 자료를 저장하지 못했습니다. 첨부와 제안은 유지되며 같은 요청으로 다시 시도할 수 있습니다.",
  };
}

async function context(write: boolean) {
  const session = await getSession();
  if (write) {
    const permission = await loadPermGuard(session.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") {
      return {
        ok: false as const,
        result: {
          ok: false as const,
          code: permission.reason === "permission" ? "permission" as const : "unavailable" as const,
          error: permission.reason === "permission"
            ? "이 기간별 자료를 저장할 권한이 없습니다."
            : "권한을 확인하지 못했습니다. 첨부 파일은 그대로 보존되어 있습니다.",
        },
      };
    }
  }
  return { ok: true as const, orgId: session.org.id, client: await createClient() };
}

export async function loadItemVatPeriodsAction(
  input: VatPeriodTarget,
): Promise<VatPeriodActionResult> {
  if (!validTarget(input)) return { ok: false, code: "unavailable", error: "기간별 자료 대상을 확인해 주세요." };
  try {
    const ctx = await context(false);
    if (!ctx.ok) return ctx.result;
    const { data, error } = await ctx.client.rpc(VAT_PERIOD_RPC.read, {
      p_org_id: ctx.orgId,
      p_board_id: input.boardId,
      p_item_id: input.itemId,
    });
    if (error) return failure(error, true);
    const snapshot = parseVatPeriodSnapshot(data);
    if (!snapshot) return failure(undefined, true);
    return { ok: true, data: snapshot, message: "저장된 기간별 자료를 불러왔습니다." };
  } catch (error) {
    return failure(error, true);
  }
}

export async function confirmItemVatPeriodsAction(
  input: ConfirmVatPeriodsInput,
): Promise<VatPeriodActionResult> {
  const confirmation = normalizeVatPeriodConfirmation(input.confirmation);
  if (
    !validTarget(input) || !UUID.test(input.requestId) ||
    !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !confirmation
  ) {
    return { ok: false, code: "request_mismatch", error: "첨부 파일·사업자번호·기간 자료를 다시 확인해 주세요." };
  }
  try {
    const ctx = await context(true);
    if (!ctx.ok) return ctx.result;
    const { data, error } = await ctx.client.rpc(VAT_PERIOD_RPC.confirm, {
      p_org_id: ctx.orgId,
      p_board_id: input.boardId,
      p_item_id: input.itemId,
      p_source_file_id: confirmation.sourceFileId,
      p_document_biz_no: confirmation.documentBizNo,
      p_periods: confirmation.periods.map((period) => ({
        period_start: period.periodStart,
        period_end: period.periodEnd,
        sales_amount: period.salesAmount,
      })),
      p_request_id: input.requestId,
      p_expected_version: input.expectedVersion,
    });
    if (error) return failure(error, false);
    const snapshot = parseVatPeriodSnapshot(data);
    if (!snapshot) return failure(undefined, false);
    revalidatePath(`/boards/${input.boardId}`);
    return {
      ok: true,
      data: snapshot,
      message: snapshot.replayed ? "같은 확정 요청을 확인했습니다." : "선택한 기간별 자료를 저장했습니다.",
    };
  } catch (error) {
    return failure(error, false);
  }
}
