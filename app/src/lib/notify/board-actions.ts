import type { Ctx } from "@/lib/types";

export interface NotificationRpcClient {
  rpc(
    name: "notify_board_item_moved",
    args: {
      p_org_id: string;
      p_board_id: string;
      p_item_id: string;
      p_event_key: string;
    },
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

/**
 * Emits the post-move notification through the request-scoped Supabase client.
 * The database owns membership, row-scope, recipient, and replay validation.
 */
export async function notifyBoardItemMoved(
  client: NotificationRpcClient,
  ctx: Ctx,
  input: { boardId: string; itemId: string; eventKey: string },
): Promise<number> {
  const { data, error } = await client.rpc("notify_board_item_moved", {
    p_org_id: ctx.org.id,
    p_board_id: input.boardId,
    p_item_id: input.itemId,
    p_event_key: input.eventKey,
  });
  if (error) throw new Error(error.message ?? "업무 이동 알림을 기록하지 못했습니다.");
  const count = Number(data);
  return Number.isFinite(count) && count > 0 ? count : 0;
}
