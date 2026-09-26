"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { recordRiskyAction } from "@/lib/perm/server";
import { AsyncCrmService } from "@/lib/crm";
import { SupabaseCrmSource } from "@/lib/repo/supabase/supabaseCrmSource";
import { userFacingMessage } from "@/lib/boards/boardActionFlash";
import { BULK_MAX_ITEMS } from "@/components/board/bulk-selection";
import { validateCompanyBulkPatch, validateDealBulkPatch } from "@/lib/companies/bulk";
import { startCompanyWork, type CompanyStartWorkClient } from "@/lib/companies/start-work";
import { createClient } from "@/lib/supabase/server";
import {
  AssignmentLineageService,
  AssignmentLineageUnavailableError,
  SupabaseAssignmentLineageRepo,
} from "@/lib/assignment-lineage";

export type CompaniesBulkItemResult = {
  itemId: string;
  ok: boolean;
  message: string;
};

export type CompaniesBulkApplyResult = {
  ok: boolean;
  applied: number;
  failed: number;
  results: CompaniesBulkItemResult[];
};

function allFailed(ids: readonly string[], message: string): CompaniesBulkApplyResult {
  return {
    ok: false,
    applied: 0,
    failed: ids.length,
    results: ids.map((itemId) => ({ itemId, ok: false as const, message })),
  };
}

function toResult(
  processed: CompaniesBulkItemResult[],
  skipped: readonly string[],
  skipMessage: string,
): CompaniesBulkApplyResult {
  const results: CompaniesBulkItemResult[] = [
    ...processed,
    ...skipped.map((itemId) => ({ itemId, ok: false as const, message: skipMessage })),
  ];
  const applied = results.filter((entry) => entry.ok).length;
  return { ok: applied > 0 && applied === results.length, applied, failed: results.length - applied, results };
}

async function requireCompaniesBulkPermission() {
  try {
    const ctx = await getSession();
    const permissions = await Promise.all([
      loadPermGuard(ctx.org.id, "work.item_upsert"),
      loadPermGuard(ctx.org.id, "danger.bulk_edit_delete"),
    ]);
    const denied = permissions.find((permission) => permission.kind !== "allowed");
    if (denied) {
      return {
        ok: false as const,
        message: denied.kind === "denied" && denied.reason === "permission"
          ? "이 일괄 작업을 실행할 권한이 없어요."
          : "권한을 확인하지 못했어요.",
      };
    }
    const audit = await recordRiskyAction(ctx.org.id, "danger.bulk_edit_delete", {
      operation: "companies_bulk_write",
    });
    if (!audit.ok) {
      return { ok: false as const, message: "일괄 작업 기록을 남기지 못해 실행하지 않았어요." };
    }
    return { ok: true as const, ctx };
  } catch (error) {
    return { ok: false as const, message: userFacingMessage(error) };
  }
}

function lineageErrorMessage(error: unknown): string {
  if (error instanceof AssignmentLineageUnavailableError) {
    if (error.code === "40001") {
      return "담당자 정보가 먼저 변경되었습니다. 새로 불러온 뒤 다시 시도해 주세요.";
    }
    if (error.code === "42501") {
      return "이 담당자 흐름을 변경할 권한이 없습니다.";
    }
    if (error.code === "22023") {
      return "이전 요청과 내용이 달라 처리할 수 없습니다. 선택을 확인해 주세요.";
    }
  }
  return userFacingMessage(error);
}

/** 회사 일반 필드 일괄 — parseUpdateCompany + AsyncCrmService.updateCompany만 쓴다. 집계 직접수정 금지. */
export async function bulkUpdateCompaniesAction(input: {
  companyIds: string[];
  field: string;
  value: unknown;
}): Promise<CompaniesBulkApplyResult> {
  const ids = [...new Set(input.companyIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  let patch: Record<string, unknown>;
  try {
    patch = validateCompanyBulkPatch(input.field, input.value);
  } catch (error) {
    return allFailed(ids, error instanceof Error ? error.message : "입력 값을 확인해 주세요.");
  }

  const gate = await requireCompaniesBulkPermission();
  if (!gate.ok) return allFailed(ids, gate.message);

  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  let crm: AsyncCrmService;
  try {
    // Bind RLS reads and writes to this request's cookies, never the cached anon client.
    crm = new AsyncCrmService(new SupabaseCrmSource(await createClient()));
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }
  const processed: CompaniesBulkItemResult[] = [];
  for (const companyId of head) {
    try {
      // tenant/row 재검증 — getCompany가 org·scope를 강제한다. 없으면 여기서 실패한다.
      await crm.getCompany(gate.ctx, companyId);
      await crm.updateCompany(gate.ctx, companyId, patch as Parameters<typeof crm.updateCompany>[2]);
      processed.push({ itemId: companyId, ok: true, message: "저장했습니다." });
    } catch (error) {
      processed.push({ itemId: companyId, ok: false, message: userFacingMessage(error) });
    }
  }
  if (processed.some((entry) => entry.ok)) revalidatePath("/companies");
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}

/** 자금 건 일반 필드 일괄 — parseUpdateDeal + updateDeal만 쓴다. board-item 액션으로 보내지 않는다. */
export async function bulkUpdateDealsAction(input: {
  dealIds: string[];
  field: string;
  value: unknown;
}): Promise<CompaniesBulkApplyResult> {
  const ids = [...new Set(input.dealIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  let patch: Record<string, unknown>;
  try {
    patch = validateDealBulkPatch(input.field, input.value);
  } catch (error) {
    return allFailed(ids, error instanceof Error ? error.message : "입력 값을 확인해 주세요.");
  }

  const gate = await requireCompaniesBulkPermission();
  if (!gate.ok) return allFailed(ids, gate.message);

  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  let crm: AsyncCrmService;
  try {
    crm = new AsyncCrmService(new SupabaseCrmSource(await createClient()));
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }
  const processed: CompaniesBulkItemResult[] = [];
  for (const dealId of head) {
    try {
      // 딜 조회 오류를 회사 집계로 우회하지 않는다 — 여기서 실패면 그 건은 실패로 남긴다.
      await crm.getDeal(gate.ctx, dealId);
      await crm.updateDeal(gate.ctx, dealId, patch as Parameters<typeof crm.updateDeal>[2]);
      processed.push({ itemId: dealId, ok: true, message: "저장했습니다." });
    } catch (error) {
      processed.push({ itemId: dealId, ok: false, message: userFacingMessage(error) });
    }
  }
  if (processed.some((entry) => entry.ok)) revalidatePath("/companies");
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}

/**
 * 자금 건 담당 일괄 — assignment lineage read->reassign만이 정본이다.
 * 보드 투영(item) 조회 실패·투영 없음은 그 건의 실패로 닫는다.
 * CRM reassign fallback으로 lineage 버전/이벤트/예약인계를 우회하지 않는다.
 * company/deal id를 board-item 액션으로 보내지 않는다.
 */
export async function bulkReassignDealsAction(input: {
  dealIds: string[];
  assigneeId: string | null;
}): Promise<CompaniesBulkApplyResult> {
  const ids = [...new Set(input.dealIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  const gate = await requireCompaniesBulkPermission();
  if (!gate.ok) return allFailed(ids, gate.message);

  let client: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    client = await createClient();
  } catch {
    client = null;
  }

  if (client && input.assigneeId) {
    try {
      const members = await client
        .from("org_members")
        .select("user_id")
        .eq("org_id", gate.ctx.org.id)
        .eq("status", "active")
        .in("user_id", [input.assigneeId]);
      if (members.error || (members.data ?? []).length !== 1) {
        return allFailed(ids, "이 회사에 속한 사람만 선택할 수 있어요.");
      }
    } catch (error) {
      return allFailed(ids, userFacingMessage(error));
    }
  }

  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  if (!client) {
    return allFailed(ids, "담당 흐름을 확인할 수 없어 저장하지 않았습니다. 새로 불러온 뒤 다시 시도해 주세요.");
  }
  const crm = new AsyncCrmService(new SupabaseCrmSource(client));
  const processed: CompaniesBulkItemResult[] = [];
  for (const dealId of head) {
    try {
      await crm.getDeal(gate.ctx, dealId);

      let lineageRef: { boardId: string; itemId: string } | null = null;
      try {
        const found = await client
          .from("items")
          .select("id,board_id,deal_id")
          .eq("org_id", gate.ctx.org.id)
          .eq("deal_id", dealId)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        if (found.error) {
          processed.push({
            itemId: dealId,
            ok: false,
            message: "담당 흐름을 확인하지 못해 저장하지 않았습니다. 새로 불러온 뒤 다시 시도해 주세요.",
          });
          continue;
        }
        const row = found.data as { id: string; board_id: string } | null;
        if (row?.id && row?.board_id) lineageRef = { boardId: row.board_id, itemId: row.id };
      } catch {
        processed.push({
          itemId: dealId,
          ok: false,
          message: "담당 흐름을 확인하지 못해 저장하지 않았습니다. 새로 불러온 뒤 다시 시도해 주세요.",
        });
        continue;
      }

      if (!lineageRef) {
        processed.push({
          itemId: dealId,
          ok: false,
          message: "보드 투영이 없어 담당 흐름(lineage)으로 처리할 수 없습니다. 해당 건을 확인한 뒤 다시 시도해 주세요.",
        });
        continue;
      }

      const actor = { orgId: gate.ctx.org.id, userId: gate.ctx.user.id };
      const lineage = new AssignmentLineageService(new SupabaseAssignmentLineageRepo(client));
      const ref = { boardId: lineageRef.boardId, dealId, itemId: lineageRef.itemId };
      let snapshot;
      try {
        snapshot = await lineage.read(actor, ref);
      } catch (error) {
        processed.push({ itemId: dealId, ok: false, message: lineageErrorMessage(error) });
        continue;
      }
      try {
        await lineage.reassign(actor, {
          ...ref,
          assignedTo: input.assigneeId,
          expectedAssignedTo: snapshot.currentAssigneeId,
          expectedVersion: snapshot.version,
          requestId: crypto.randomUUID(),
        });
        processed.push({ itemId: dealId, ok: true, message: "저장했습니다." });
      } catch (error) {
        processed.push({ itemId: dealId, ok: false, message: lineageErrorMessage(error) });
      }
    } catch (error) {
      processed.push({ itemId: dealId, ok: false, message: userFacingMessage(error) });
    }
  }
  if (processed.some((entry) => entry.ok)) revalidatePath("/companies");
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}

/**
 * 회사 명시적 업무 시작 일괄 — startCompanyWork/start_company_work_v2만 쓴다.
 * 존재하지 않는 작업을 작동하는 버튼처럼 두지 않는다 — RPC 결과를 그대로 돌려준다.
 */
export async function bulkStartWorkAction(input: {
  companyIds: string[];
}): Promise<CompaniesBulkApplyResult> {
  const ids = [...new Set(input.companyIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  const gate = await requireCompaniesBulkPermission();
  if (!gate.ok) return allFailed(ids, gate.message);

  let client: Awaited<ReturnType<typeof createClient>>;
  try {
    client = await createClient();
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  const crm = new AsyncCrmService(new SupabaseCrmSource(client));
  const processed: CompaniesBulkItemResult[] = [];
  for (const companyId of head) {
    try {
      await crm.getCompany(gate.ctx, companyId);
      await startCompanyWork(client as unknown as CompanyStartWorkClient, {
        orgId: gate.ctx.org.id,
        companyId,
        requestId: crypto.randomUUID(),
      });
      processed.push({ itemId: companyId, ok: true, message: "업무를 시작했습니다." });
    } catch (error) {
      processed.push({ itemId: companyId, ok: false, message: userFacingMessage(error) });
    }
  }
  if (processed.some((entry) => entry.ok)) {
    revalidatePath("/companies");
    revalidatePath("/work");
  }
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}

/** CSV 내보내기 권한 재검증 + 감사 — danger.csv_export. 실제 파일은 호출부가 만든다. */
export async function authorizeCompaniesCsvExport(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const ctx = await getSession();
    const permission = await loadPermGuard(ctx.org.id, "danger.csv_export");
    if (permission.kind !== "allowed") {
      return {
        ok: false,
        message: permission.reason === "permission" ? "CSV를 내보낼 권한이 없어요." : "권한을 확인하지 못했어요.",
      };
    }
    const audit = await recordRiskyAction(ctx.org.id, "danger.csv_export", {
      operation: "companies_selection_csv_export",
    });
    return audit.ok
      ? { ok: true }
      : { ok: false, message: "내보내기 기록을 남기지 못해 파일을 만들지 않았어요." };
  } catch {
    return { ok: false, message: "내보내기 권한을 확인하지 못했어요." };
  }
}
