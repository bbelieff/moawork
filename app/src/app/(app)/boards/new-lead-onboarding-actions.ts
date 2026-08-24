"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createClient } from "@/lib/supabase/server";
import { NEW_LEAD_ONBOARDING_VERSION } from "@/lib/new-lead/onboarding";

export type OnboardingActionState = Readonly<{ ok: boolean; message: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function saveNewLeadOnboardingAction(
  _previous: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const value = formData.get("state");
  const boardId = formData.get("boardId");
  const requestId = formData.get("requestId");
  if ((value !== "completed" && value !== "dismissed") || typeof boardId !== "string" || !boardId || typeof requestId !== "string" || !UUID.test(requestId)) {
    return { ok: false, message: "도움말 상태를 저장하지 못했습니다." };
  }
  const ctx = await getSession();
  const permission = await loadPermGuard(ctx.org.id, "work.view_tabs");
  if (permission.kind !== "allowed") return { ok: false, message: "도움말 상태를 저장할 권한이 없습니다." };
  const { error } = await (await createClient()).rpc("set_new_lead_onboarding_state", {
    p_org_id: ctx.org.id,
    p_version: NEW_LEAD_ONBOARDING_VERSION,
    p_state: value,
    p_request_id: requestId,
  });
  if (error) return { ok: false, message: "도움말 상태를 저장하지 못했습니다." };
  revalidatePath(`/boards/${boardId}`);
  return { ok: true, message: value === "completed" ? "도움말을 완료했습니다." : "도움말을 닫았습니다." };
}
