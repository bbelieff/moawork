"use server";

import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type SealApprovalRequestResult = Readonly<{
  ok: boolean;
  message: string;
}>;

/** Permission, idempotency and audit are enforced atomically by migration 070. */
export async function requestSealApprovalAction(
  dealId: string,
  requestId: string,
): Promise<SealApprovalRequestResult> {
  if (!dealId || !requestId) return { ok: false, message: "승인 요청 대상을 확인할 수 없습니다." };
  try {
    const ctx = await getSession();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("request_deal_seal_approval", {
      p_org_id: ctx.org.id,
      p_deal_id: dealId,
      p_request_id: requestId,
    });
    if (error) return { ok: false, message: `승인 요청을 보내지 못했습니다: ${error.message}` };
    if (data === "sent") return { ok: true, message: "대표 직인 승인 요청을 보냈습니다." };
    if (data === "already_sent") return { ok: true, message: "이미 같은 승인 요청을 보냈습니다." };
    if (data === "no_approver") return { ok: false, message: "승인할 대표 또는 관리자가 없습니다." };
    return { ok: false, message: "승인 요청 결과를 확인할 수 없습니다." };
  } catch (error) {
    return { ok: false, message: `승인 요청을 보내지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}` };
  }
}
