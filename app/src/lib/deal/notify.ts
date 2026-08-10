/**
 * 딜 협업 알림 발행 — RPC 호출부 (BBE-16).
 *
 * `035_deal_collab_notify.sql` 의 `mention_org_members` / `request_deal_followup`
 * SECURITY DEFINER 함수를 부른다. 실제 검증(멤버십·조직 경계)은 함수 내부에서
 * 다시 하므로 여기서는 얇게 전달만 한다.
 *
 * Supabase 미설정(로컬 개발)이면 조용히 스킵한다 — `lib/notify` 전반의 규약과 동일:
 * "알림"은 실DB 기능이고, 로컬 개발은 그 부분만 빈 동작으로 대체된다.
 * 담당자 배정 알림(`trg_notify_deal_assigned`)은 DB 트리거라 이 파일이 다루지 않는다
 * (deals.assigned_to 갱신 자체가 이미 asyncService 를 통해 실DB에 반영되면 자동 발화).
 */

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Ctx } from "@/lib/types";

/** 실패해도 화면(댓글 저장)을 막지 않는다 — 알림은 부가 기능이다. */
async function safeRpc(name: string, args: Record<string, unknown>): Promise<void> {
  if (!hasSupabaseEnv()) return;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc(name, args);
    if (error) console.warn(`[deal-notify] ${name} 실패:`, error.message);
  } catch (err) {
    console.warn(`[deal-notify] ${name} 예외:`, err instanceof Error ? err.message : err);
  }
}

/** 댓글에서 언급된 조직 멤버들에게 알림. */
export async function notifyMentions(
  ctx: Ctx,
  dealId: string,
  mentionedUserIds: readonly string[],
): Promise<void> {
  if (mentionedUserIds.length === 0) return;
  await safeRpc("mention_org_members", {
    p_org_id: ctx.org.id,
    p_deal_id: dealId,
    p_user_ids: [...mentionedUserIds],
  });
}

/** 되돌려보내기(보완요청) — 현재 담당자에게 알림. */
export async function notifyFollowupRequested(ctx: Ctx, dealId: string): Promise<void> {
  await safeRpc("request_deal_followup", { p_org_id: ctx.org.id, p_deal_id: dealId });
}
