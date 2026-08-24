"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createClient } from "@/lib/supabase/server";
import { canonicalAssignee, createCanonicalNewLead, NewLeadMutationError, updateCanonicalNewLead, updateCanonicalNewLeadMeta, updateCanonicalNewLeadTitle } from "@/lib/new-lead/mutations";
import type { NewLeadIntakeState } from "@/lib/new-lead/intake-state";
import { CELL_FLASH_COOKIE, CELL_FLASH_MAX_AGE, encodeCellFlash } from "@/lib/boards/cellFlash";
import { NEW_LEAD_BUSINESS_TYPES } from "@/lib/new-lead/business-types";
import { advanceNewLeadToContact, NewLeadAdvanceError } from "@/lib/new-lead/advance";

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
  const businessType = text(formData, "business_registration_type");
  if (!title) { record("invalid_title"); return { ok: false, field: "title", message: "이름을 입력해 주세요. 나머지는 등록 후 채울 수 있어요." }; }
  if (!NEW_LEAD_BUSINESS_TYPES.includes(businessType as (typeof NEW_LEAD_BUSINESS_TYPES)[number])) {
    record("invalid_business_type");
    return { ok: false, field: "business_registration_type", message: "사업자 구분을 선택해 주세요." };
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
      p_phone: text(formData, "phone") || null,
      p_email: text(formData, "email") || null,
      p_business_registration_type: businessType,
      p_industry: text(formData, "industry") || null,
      p_revenue_band: text(formData, "revenue_band") || null,
      p_region_sido: text(formData, "region_sido") || null,
      p_region_sigungu: text(formData, "region_sigungu") || null,
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
    await updateCanonicalNewLead(await createClient(), { orgId: ctx.org.id, dealId, requestId: text(formData, "requestId") || crypto.randomUUID(), patch: { [field]: text(formData, "value") || null }, valueSource: "manual" });
    await clearCanonicalError();
  } catch(error) { await flashCanonicalError(itemId,columnKey,error); }
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/newcust");
}

export async function updateNewLeadMetaAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId=text(formData,"boardId"),dealId=text(formData,"dealId"),itemId=text(formData,"itemId"),field=text(formData,"field");
  const allowed = new Set(["owner","collaborators","applied_on","address_detail"]);
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
