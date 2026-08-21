/**
 * 딜 협업 알림 발행 — RPC 호출부 (BBE-16).
 *
 * `064_deal_collab_notify.sql` 의 `mention_org_members` / `request_deal_followup`
 * SECURITY DEFINER 함수를 부른다. 실제 검증(멤버십·조직 경계)은 함수 내부에서
 * 다시 하므로 여기서는 얇게 전달만 한다.
 *
 * 댓글 멘션은 부가 알림이라 Supabase 미설정 시 조용히 스킵한다. 반면 보완요청은
 * 담당자 전달 자체가 목적이므로 미설정·RPC 실패·대상 부재를 타입 결과로 호출부에 돌려준다.
 * 담당자 배정 알림(`trg_notify_deal_assigned`)은 DB 트리거라 이 파일이 다루지 않는다
 * (deals.assigned_to 갱신 자체가 이미 asyncService 를 통해 실DB에 반영되면 자동 발화).
 */

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Ctx } from "@/lib/types";

export type FollowupNotificationOutcome =
  | { status: "sent" }
  | {
      status: "not_sent";
      reason: "no_assignee" | "self_assigned" | "invalid_assignee" | "unavailable" | "rpc_error";
      message: string;
    };

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
  eventKey: string,
): Promise<void> {
  if (mentionedUserIds.length === 0) return;
  await safeRpc("mention_org_members", {
    p_org_id: ctx.org.id,
    p_deal_id: dealId,
    p_user_ids: [...mentionedUserIds],
    p_event_key: eventKey,
  });
}

/** 되돌려보내기(보완요청) — 실패를 성공처럼 삼키지 않고 타입으로 호출부에 돌려준다. */
export async function notifyFollowupRequested(
  ctx: Ctx,
  dealId: string,
  eventKey: string,
): Promise<FollowupNotificationOutcome> {
  if (!hasSupabaseEnv()) {
    return {
      status: "not_sent",
      reason: "unavailable",
      message: "알림 저장소가 연결되지 않아 보완 요청을 전달하지 못했습니다.",
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("request_deal_followup", {
      p_org_id: ctx.org.id,
      p_deal_id: dealId,
      p_event_key: eventKey,
    });
    if (error) {
      return {
        status: "not_sent",
        reason: "rpc_error",
        message: `보완 요청 알림을 저장하지 못했습니다: ${error.message}`,
      };
    }

    const result = typeof data === "string" ? data : "";
    // 같은 댓글 이벤트의 재시도는 이미 영속 알림이 있으므로 사용자 관점에서는 성공이다.
    if (result === "sent" || result === "duplicate") return { status: "sent" };
    const messages = {
      no_assignee: "담당자가 없어 보완 요청을 전달하지 못했습니다.",
      self_assigned: "현재 담당자가 요청자 본인이라 알림을 보내지 않았습니다.",
      invalid_assignee: "현재 담당자가 이 회사의 멤버가 아니라 알림을 보내지 않았습니다.",
    } as const;
    if (
      result === "no_assignee" ||
      result === "self_assigned" ||
      result === "invalid_assignee"
    ) {
      return { status: "not_sent", reason: result, message: messages[result] };
    }
    return {
      status: "not_sent",
      reason: "rpc_error",
      message: "알림 저장소가 알 수 없는 결과를 반환했습니다.",
    };
  } catch (err) {
    return {
      status: "not_sent",
      reason: "rpc_error",
      message: `보완 요청 알림을 저장하지 못했습니다: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
    };
  }
}
