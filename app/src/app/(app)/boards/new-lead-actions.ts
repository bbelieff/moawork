"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createClient } from "@/lib/supabase/server";
import { canonicalAssignee, createCanonicalNewLead, NewLeadMutationError, updateCanonicalNewLead, updateCanonicalNewLeadMeta, updateCanonicalNewLeadTitle } from "@/lib/new-lead/mutations";
import type { NewLeadIntakeState } from "@/lib/new-lead/intake-state";
import { CELL_FLASH_COOKIE, CELL_FLASH_MAX_AGE, encodeCellFlash } from "@/lib/boards/cellFlash";
import { resolveNewLeadBusinessType } from "@/lib/new-lead/business-types";
import { resolveNewLeadRevenueBand } from "@/lib/new-lead/revenue-bands";
import { canonicalSido, canonicalSigungu } from "@/lib/new-lead/region-search";
import { analyzePhone } from "@/lib/format/phone";
import { advanceNewLeadToContact, NewLeadAdvanceError } from "@/lib/new-lead/advance";
import { createRequestBoards } from "@/lib/boards/server";
import {
  CREDIT_SCORE_KEYS,
  EXISTING_LOAN_RECORDS_KEY,
  NEW_LEAD_COMPOSITE_FIELD_KEYS,
  parseCreditScore,
  parseExistingLoanRecords,
  parseFoundedDate,
  parseRevenue3yMillion,
  type ExistingLoanRecord,
} from "@/lib/new-lead/financial-profile";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function textList(formData: FormData, key: string): string[] {
  return formData.getAll(key).flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []);
}

async function flashCanonicalError(itemId: string, key: string, error: unknown) {
  const message = error instanceof NewLeadMutationError ? error.message : "신규리드를 저장하지 못했습니다. 다시 시도해 주세요.";
  const encoded = encodeCellFlash({ itemId, errors: [{ key, label: key, message }] });
  if (encoded) (await cookies()).set(CELL_FLASH_COOKIE, encoded, { httpOnly: true, sameSite: "lax", path: "/", maxAge: CELL_FLASH_MAX_AGE });
}

async function clearCanonicalError() { (await cookies()).set(CELL_FLASH_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 }); }

export async function createNewLeadAction(
  _previous: NewLeadIntakeState,
  formData: FormData,
): Promise<NewLeadIntakeState> {
  const startedAt = performance.now();
  const record = (outcome: string, permissionMs?: number) => {
    if (process.env.NODE_ENV !== "production") return;
    console.info(JSON.stringify({
      event: "mw.performance",
      route: "new_lead_create",
      outcome,
      total_ms: Math.round(performance.now() - startedAt),
      ...(permissionMs === undefined ? {} : { permission_ms: Math.round(permissionMs) }),
    }));
  };
  const ctx = await getSession();
  const title = text(formData, "title");
  const boardId = text(formData, "boardId");
  const groupId = text(formData, "groupId");
  const businessType = resolveNewLeadBusinessType(
    text(formData, "business_registration_type"),
    text(formData, "business_registration_type_custom"),
  );
  const phone = analyzePhone(text(formData, "phone"));
  const revenueBand = resolveNewLeadRevenueBand(
    text(formData, "revenue_band"),
    text(formData, "revenue_band_custom"),
  );
  const rawSido = text(formData, "region_sido");
  const rawSigungu = text(formData, "region_sigungu");
  const regionSido = rawSido ? canonicalSido(rawSido) : "";
  const regionSigungu = rawSigungu ? canonicalSigungu(regionSido, rawSigungu) : "";
  if (!title) { record("invalid_title"); return { ok: false, field: "title", message: "이름을 입력해 주세요. 나머지는 등록 후 채울 수 있어요." }; }
  if (!businessType) {
    record("invalid_business_type");
    return { ok: false, field: "business_registration_type", message: "사업자유형을 입력해 주세요." };
  }
  if (phone.status === "needs_review") {
    record("invalid_phone");
    return { ok: false, field: "phone", message: "연락처를 확인해 주세요. +82·0082·820 형식도 국내 번호로 자동 정리합니다." };
  }
  if (text(formData, "revenue_band") === "그외" && !revenueBand) {
    record("invalid_revenue_band");
    return { ok: false, field: "revenue_band", message: "그외 매출 구간을 입력해 주세요." };
  }
  if (rawSido && !regionSido) {
    record("invalid_region_sido");
    return { ok: false, field: "region_sido", message: "시도를 추천 목록에서 선택해 주세요." };
  }
  if (rawSigungu && !regionSigungu) {
    record("invalid_region_sigungu");
    return { ok: false, field: "region_sido", message: "시군구를 추천 목록에서 선택해 주세요." };
  }
  if (!boardId || !groupId) { record("invalid_target"); return { ok: false, field: "form", message: "신규리드 보드 구성을 확인해 주세요." }; }

  const permissionStartedAt = performance.now();
  const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
  const permissionMs = performance.now() - permissionStartedAt;
  if (permission.kind !== "allowed") {
    record(permission.reason === "permission" ? "denied" : "unavailable", permissionMs);
    return { ok: false, field: "form", message: permission.reason === "permission" ? "신규리드를 등록할 권한이 없습니다." : "권한을 확인하지 못했습니다." };
  }

  try {
    const row = await createCanonicalNewLead(await createClient(), {
      p_org_id: ctx.org.id,
      p_board_id: boardId,
      p_group_id: groupId,
      p_request_id: text(formData, "requestId") || crypto.randomUUID(),
      p_title: title,
      p_representative_name: text(formData, "representative_name") || null,
      p_phone: phone.status === "normalized" ? phone.normalized : null,
      p_email: text(formData, "email") || null,
      p_business_registration_type: businessType,
      p_industry: text(formData, "industry") || null,
      p_revenue_band: revenueBand,
      p_region_sido: regionSido || null,
      p_region_sigungu: regionSigungu || null,
      p_address_detail: text(formData, "address_detail") || null,
      p_acquisition_source: text(formData, "acquisition_source") || null,
      p_assigned_to: canonicalAssignee(ctx.user.id, text(formData, "assigned_to")),
      p_collaborator_ids: textList(formData, "collaborator_ids"),
    });
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/newcust");
    record(row.replayed ? "replayed" : "created", permissionMs);
    return { ok: true, message: "신규리드를 등록했습니다.", itemId: row.item_id };
  } catch (error) {
    record("error", permissionMs);
    return {
      ok: false,
      field: "form",
      message: error instanceof NewLeadMutationError ? error.message : "신규리드를 저장하지 못했습니다. 다시 시도해 주세요.",
    };
  }
}

export type AdvanceNewLeadState = Readonly<{ ok: boolean; message: string }>;
export type SaveNewLeadDetailFieldState = Readonly<{ ok: boolean; message: string }>;
export type SaveNewLeadFinancialState = Readonly<{ ok: boolean; message: string }>;
export type SaveNewLeadLoanProfileResult = Readonly<{
  ok: boolean;
  message: string;
  requestId: string;
  boardId: string;
  itemId: string;
  records: readonly ExistingLoanRecord[];
}>;

const DETAIL_FIELD_PATCH = {
  rep_name: "representative_name",
  phone: "phone",
  email: "email",
  biz_reg_type: "business_registration_type",
  industry: "industry",
  revenue_band: "revenue_band",
  sido: "region_sido",
  sigungu: "region_sigungu",
  ad_name: "acquisition_source",
} as const;

/** 회사 상세의 자동 저장도 표와 같은 canonical deal/item/audit 경로를 관통한다. */
export async function saveNewLeadDetailFieldAction(input: {
  boardId: string;
  itemId: string;
  dealId: string;
  fieldKey: string;
  value: string;
}): Promise<SaveNewLeadDetailFieldState> {
  const ctx = await getSession();
  const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
  if (permission.kind !== "allowed") {
    return { ok: false, message: permission.reason === "permission" ? "이 회사를 저장할 권한이 없습니다." : "권한을 확인하지 못했습니다." };
  }
  try {
    const client = await createClient();
    if (input.fieldKey === "phone" && analyzePhone(input.value).status === "needs_review") {
      return { ok: false, message: "연락처를 확인해 주세요. 저장하지 않았습니다." };
    }
    if (input.fieldKey === "applied_on" || input.fieldKey === "address_detail") {
      await updateCanonicalNewLeadMeta(client, {
        orgId: ctx.org.id,
        dealId: input.dealId,
        requestId: crypto.randomUUID(),
        patch: { [input.fieldKey]: input.value || null },
      });
    } else {
      const field = DETAIL_FIELD_PATCH[input.fieldKey as keyof typeof DETAIL_FIELD_PATCH];
      if (!field) return { ok: false, message: "이 필드는 표에서 수정해 주세요." };
      await updateCanonicalNewLead(client, {
        orgId: ctx.org.id,
        dealId: input.dealId,
        requestId: crypto.randomUUID(),
        patch: { [field]: input.value || null },
        valueSource: "manual",
      });
    }
    revalidatePath(`/boards/${input.boardId}`);
    revalidatePath("/newcust");
    return { ok: true, message: "✓ 자동 저장됨" };
  } catch (error) {
    return { ok: false, message: error instanceof NewLeadMutationError ? error.message : "저장하지 못했습니다. 다시 시도해 주세요." };
  }
}

export async function saveNewLeadLoanProfileAction(
  _previous: SaveNewLeadFinancialState,
  formData: FormData,
): Promise<SaveNewLeadLoanProfileResult> {
  const ctx = await getSession();
  const boardId = text(formData, "boardId");
  const itemId = text(formData, "itemId");
  const requestId = text(formData, "requestId");
  const failure = (message: string): SaveNewLeadLoanProfileResult => ({
    ok: false,
    message,
    requestId,
    boardId,
    itemId,
    records: [],
  });
  if (!boardId || !itemId || !requestId) return failure("기대출 저장 요청을 확인해 주세요.");
  const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
  if (permission.kind !== "allowed") {
    return failure(permission.reason === "permission" ? "기대출을 저장할 권한이 없습니다." : "권한을 확인하지 못했습니다.");
  }
  const records = parseExistingLoanRecords(text(formData, "loanRecords"));
  if (!records.ok) return failure(records.message);

  try {
    const graph = await createRequestBoards();
    const result = await graph.service.setCells(ctx, boardId, itemId, {
      // `[]` is an explicit migrated-empty sentinel. `null` means the canonical
      // list has never been saved and therefore still permits the legacy fallback.
      [EXISTING_LOAN_RECORDS_KEY]: JSON.stringify(records.value),
    });
    if (result.errors.length > 0) {
      return failure(result.errors.map((error) => `${error.label}: ${error.message}`).join(" · "));
    }
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/newcust");
    return {
      ok: true,
      message: "기대출 정보를 저장했습니다.",
      requestId,
      boardId,
      itemId,
      records: records.value,
    };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "기대출을 저장하지 못했습니다.");
  }
}

export async function saveNewLeadCreditScoreAction(
  _previous: SaveNewLeadFinancialState,
  formData: FormData,
): Promise<SaveNewLeadFinancialState> {
  const ctx = await getSession();
  const boardId = text(formData, "boardId");
  const itemId = text(formData, "itemId");
  const fieldKey = text(formData, "fieldKey");
  const label = fieldKey === CREDIT_SCORE_KEYS.ncb ? "NCB" : fieldKey === CREDIT_SCORE_KEYS.kcb ? "KCB" : null;
  if (!boardId || !itemId || !label) return { ok: false, message: "신용점수를 저장할 회사를 확인해 주세요." };
  const score = parseCreditScore(text(formData, "score"), label);
  if (!score.ok) return { ok: false, message: score.message };
  const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
  if (permission.kind !== "allowed") {
    return { ok: false, message: permission.reason === "permission" ? "신용점수를 저장할 권한이 없습니다." : "권한을 확인하지 못했습니다." };
  }
  try {
    const result = await (await createRequestBoards()).service.setCells(ctx, boardId, itemId, {
      [fieldKey]: score.value,
    });
    const failure = result.errors.find((error) => error.key === fieldKey);
    if (failure) return { ok: false, message: failure.message };
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/newcust");
    return { ok: true, message: `${label} 점수를 저장했습니다.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "신용점수를 저장하지 못했습니다." };
  }
}

export async function saveNewLeadFoundedDateAction(
  _previous: SaveNewLeadFinancialState,
  formData: FormData,
): Promise<SaveNewLeadFinancialState> {
  const ctx = await getSession();
  const boardId = text(formData, "boardId");
  const itemId = text(formData, "itemId");
  if (!boardId || !itemId) return { ok: false, message: "창업연월을 저장할 회사를 확인해 주세요." };
  const founded = parseFoundedDate(text(formData, "foundedDate"));
  if (!founded.ok) return { ok: false, message: founded.message };
  const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
  if (permission.kind !== "allowed") {
    return { ok: false, message: permission.reason === "permission" ? "창업연월을 저장할 권한이 없습니다." : "권한을 확인하지 못했습니다." };
  }
  try {
    const result = await (await createRequestBoards()).service.setCells(ctx, boardId, itemId, {
      [NEW_LEAD_COMPOSITE_FIELD_KEYS.foundedDate]: founded.value.value,
    });
    if (result.errors.length > 0) return { ok: false, message: result.errors.map((error) => error.message).join(" · ") };
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/newcust");
    return { ok: true, message: "창업연월을 저장했습니다." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "창업연월을 저장하지 못했습니다." };
  }
}

export async function saveNewLeadRevenue3yAction(
  _previous: SaveNewLeadFinancialState,
  formData: FormData,
): Promise<SaveNewLeadFinancialState> {
  const ctx = await getSession();
  const boardId = text(formData, "boardId");
  const itemId = text(formData, "itemId");
  if (!boardId || !itemId) return { ok: false, message: "3개년매출을 저장할 회사를 확인해 주세요." };
  const revenue = parseRevenue3yMillion(text(formData, "revenue3yMillion"));
  if (!revenue.ok) return { ok: false, message: revenue.message };
  const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
  if (permission.kind !== "allowed") {
    return { ok: false, message: permission.reason === "permission" ? "3개년매출을 저장할 권한이 없습니다." : "권한을 확인하지 못했습니다." };
  }
  try {
    const result = await (await createRequestBoards()).service.setCells(ctx, boardId, itemId, {
      [NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion]: revenue.value,
    });
    if (result.errors.length > 0) return { ok: false, message: result.errors.map((error) => error.message).join(" · ") };
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/newcust");
    return { ok: true, message: "3개년매출을 저장했습니다." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "3개년매출을 저장하지 못했습니다." };
  }
}

export async function advanceNewLeadFromDetailAction(
  _previous: AdvanceNewLeadState,
  formData: FormData,
): Promise<AdvanceNewLeadState> {
  const ctx = await getSession();
  const boardId = text(formData, "boardId");
  const itemId = text(formData, "itemId");
  if (!boardId || !itemId) return { ok: false, message: "전환할 신규리드를 확인해 주세요." };
  const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
  if (permission.kind !== "allowed") {
    return { ok: false, message: permission.reason === "permission" ? "리드를 넘길 권한이 없습니다." : "권한을 확인하지 못했습니다." };
  }
  try {
    const result = await advanceNewLeadToContact(await createClient(), {
      itemId,
      requestId: text(formData, "requestId") || crypto.randomUUID(),
    });
    if (result.status !== "committed") {
      return {
        ok: false,
        message: result.reason || (result.status === "blocked" ? "리드컨택 전환 조건을 확인해 주세요." : "전환이 완료되지 않아 원래 상태로 되돌렸습니다."),
      };
    }
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/contract");
    return { ok: true, message: "리드컨택으로 넘겼습니다." };
  } catch (error) {
    return { ok: false, message: error instanceof NewLeadAdvanceError ? error.message : "리드컨택으로 넘기지 못했습니다. 다시 시도해 주세요." };
  }
}

export async function updateNewLeadFieldAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = text(formData, "boardId");
  const dealId = text(formData, "dealId");
  const field = text(formData, "field");
  const allowed = new Set([
    "representative_name", "phone", "email", "business_registration_type", "industry",
    "revenue_band", "region_sido", "region_sigungu", "acquisition_source",
  ]);
  const itemId=text(formData,"itemId"), columnKey=text(formData,"columnKey");
  try {
    if (!boardId || !dealId || !itemId || !allowed.has(field)) throw new NewLeadMutationError("신규리드 편집 대상을 확인해 주세요.","22023");
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") throw new NewLeadMutationError("이 신규리드를 저장할 권한이 없습니다.","42501");
    const rawValue = text(formData, "value");
    const phone = field === "phone" ? analyzePhone(rawValue) : null;
    if (phone?.status === "needs_review") throw new NewLeadMutationError("연락처를 확인해 주세요. 저장하지 않았습니다.", "22023");
    const value = phone?.status === "normalized" ? phone.normalized : rawValue || null;
    await updateCanonicalNewLead(await createClient(), { orgId: ctx.org.id, dealId, requestId: text(formData, "requestId") || crypto.randomUUID(), patch: { [field]: value }, valueSource: "manual" });
    await clearCanonicalError();
  } catch(error) { await flashCanonicalError(itemId,columnKey,error); }
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/newcust");
}

export async function updateNewLeadMetaAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId=text(formData,"boardId"),dealId=text(formData,"dealId"),itemId=text(formData,"itemId"),field=text(formData,"field");
  // 담당자(owner)는 append-only assignment lineage RPC만 사용한다. 이 legacy
  // meta action은 비담당 메타 필드만 보존하며 owner fallback을 제공하지 않는다.
  const allowed = new Set(["collaborators","applied_on","address_detail"]);
  try {
    if (!boardId || !dealId || !itemId || !allowed.has(field)) throw new NewLeadMutationError("신규리드 편집 대상을 확인해 주세요.","22023");
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") throw new NewLeadMutationError("이 신규리드를 저장할 권한이 없습니다.","42501");
    const value: unknown = field === "collaborators" ? textList(formData,"value") : text(formData,"value") || null;
    await updateCanonicalNewLeadMeta(await createClient(), { orgId: ctx.org.id, dealId, requestId: text(formData,"requestId") || crypto.randomUUID(), patch: { [field]: value } });
    await clearCanonicalError();
  } catch(error) { await flashCanonicalError(itemId,field,error); }
  revalidatePath(`/boards/${boardId}`); revalidatePath("/newcust");
}

export async function updateNewLeadTitleAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = text(formData, "boardId"), dealId = text(formData, "dealId"), title = text(formData, "title");
  const itemId=text(formData,"itemId");
  try {
    if (!boardId || !dealId || !itemId || !title) throw new NewLeadMutationError("이름을 입력해 주세요.","22023");
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") throw new NewLeadMutationError("이 신규리드를 저장할 권한이 없습니다.","42501");
    await updateCanonicalNewLeadTitle(await createClient(), { orgId: ctx.org.id, dealId, title, requestId: crypto.randomUUID(), valueSource: "manual" });
    await clearCanonicalError();
  } catch(error) { await flashCanonicalError(itemId,"title",error); }
  revalidatePath(`/boards/${boardId}`); revalidatePath("/newcust");
}
