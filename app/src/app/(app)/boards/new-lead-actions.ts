"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createClient } from "@/lib/supabase/server";
import { createCanonicalNewLead, NewLeadMutationError, updateCanonicalNewLead } from "@/lib/new-lead/mutations";
import type { NewLeadIntakeState } from "@/lib/new-lead/intake-state";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createNewLeadAction(
  _previous: NewLeadIntakeState,
  formData: FormData,
): Promise<NewLeadIntakeState> {
  const ctx = await getSession();
  const title = text(formData, "title");
  const boardId = text(formData, "boardId");
  const groupId = text(formData, "groupId");
  if (!title) return { ok: false, field: "title", message: "이름을 입력해 주세요. 나머지는 등록 후 채울 수 있어요." };
  if (!boardId || !groupId) return { ok: false, field: "form", message: "신규리드 보드 구성을 확인해 주세요." };

  const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
  if (permission.kind !== "allowed") {
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
      p_industry: text(formData, "industry") || null,
      p_region_sido: text(formData, "region_sido") || null,
      p_acquisition_source: text(formData, "acquisition_source") || null,
    });
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/newcust");
    return { ok: true, message: "신규리드를 등록했습니다.", itemId: row.item_id };
  } catch (error) {
    return {
      ok: false,
      field: "form",
      message: error instanceof NewLeadMutationError ? error.message : "신규리드를 저장하지 못했습니다. 다시 시도해 주세요.",
    };
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
  if (!boardId || !dealId || !allowed.has(field)) return;
  const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
  if (permission.kind !== "allowed") return;
  await updateCanonicalNewLead(await createClient(), {
    orgId: ctx.org.id,
    dealId,
    requestId: text(formData, "requestId") || crypto.randomUUID(),
    patch: { [field]: text(formData, "value") || null },
    valueSource: "manual",
  });
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/newcust");
}
