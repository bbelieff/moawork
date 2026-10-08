import { after } from "next/server";
import type { Ctx } from "@/lib/types";
import { createRequestBoards } from "@/lib/boards/server";

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const lastPurgeAt = new Map<string, number>();

/**
 * #849 — 7일 지난 휴지통 탭을 지운다. 운영 DB 에 pg_cron 이 없어서, 탭 관리 권한(structure.tab_manage)이
 * 있는 사람이 앱을 열 때 함께 돌린다.
 * Issue 857 — 화면을 기다리게 하지 않도록 응답을 보낸 «뒤에» 돌리고, 회사마다 몇 시간에 한 번만 돈다
 * (서버 한 프로세스 기준, 실패하면 다음 화면에서 다시). 탭 관리 화면은 열 때마다 바로 정리한다.
 * 요청 클라이언트는 쿠키를 읽어야 하므로 응답 전에 만들어 둔다.
 */
export async function scheduleExpiredTrashPurge(ctx: Ctx, canManageTabs: boolean): Promise<void> {
  if (!canManageTabs) return;
  const now = Date.now();
  if (now - (lastPurgeAt.get(ctx.org.id) ?? 0) < PURGE_INTERVAL_MS) return;
  lastPurgeAt.set(ctx.org.id, now);
  let repo: Awaited<ReturnType<typeof createRequestBoards>>["repo"];
  try {
    repo = (await createRequestBoards()).repo;
  } catch {
    return;
  }
  try {
    after(async () => {
      try {
        await repo.purgeExpiredBoards(ctx);
      } catch {
        // 다음 화면에서 다시 정리한다.
        lastPurgeAt.delete(ctx.org.id);
      }
    });
  } catch {
    // 요청 밖(시험 등)에서는 미룰 곳이 없다 — 이번엔 건너뛴다.
    lastPurgeAt.delete(ctx.org.id);
  }
}
