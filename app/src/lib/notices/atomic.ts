import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";

export async function ensureNoticeTabAtomic(ctx: Ctx, client: SupabaseClient): Promise<string> {
  const { data, error } = await client.rpc("bbe151_ensure_notice_tab", { p_org_id: ctx.org.id });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.board_id !== "string") throw new Error("공지 기본 탭을 확인하지 못했습니다.");
  return row.board_id;
}

export async function markNoticeItemsReadAtomic(ctx: Ctx, itemIds: readonly string[], client: SupabaseClient): Promise<void> {
  await Promise.all(itemIds.map(async (itemId) => {
    const { error } = await client.rpc("bbe151_mark_notice_read", { p_org_id: ctx.org.id, p_item_id: itemId });
    if (error && error.code !== "P0002") throw new Error(error.message);
  }));
}
