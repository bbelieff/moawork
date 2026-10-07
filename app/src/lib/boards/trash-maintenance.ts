import type { Ctx } from "@/lib/types";
import { createRequestBoards } from "@/lib/boards/server";

/**
 * #849 — 7일 지난 휴지통 탭을 지운다. 운영 DB 에 pg_cron 이 없어서, 탭 관리 권한이 있는 사람이
 * 앱을 열 때 함께 돌린다. 지울 것이 없으면 색인 한 번 보고 끝나고, 실패해도 화면은 그대로 뜬다.
 */
export async function purgeExpiredTrashedTabs(ctx: Ctx): Promise<number> {
  if (ctx.role !== "owner" && ctx.role !== "admin") return 0;
  try {
    return await (await createRequestBoards()).repo.purgeExpiredBoards(ctx);
  } catch {
    return 0;
  }
}
