import type { SupabaseClient } from "@supabase/supabase-js";
import type { Board, DefaultTabDismissal } from "@/lib/boards/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { NOTICE_TAB } from "@/lib/default-tabs/notice";
import { NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import { isDefaultTabDismissed } from "@/lib/default-tabs/install";
import { repairDefaultTabOnEntry } from "@/lib/default-tabs/repair-on-entry";
import type { Ctx } from "@/lib/types";

export type NoticeEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "dismissed" };

export interface NoticeBoardsReader {
  listBoards(ctx: Ctx): Promise<Board[]>;
  listDefaultTabDismissals(ctx: Ctx): Promise<DefaultTabDismissal[]>;
}

/** Resolve the installed product notice tab without mutating data on GET. */
export async function resolveExistingNoticeBoard(
  ctx: Ctx,
  repo: NoticeBoardsReader,
): Promise<NoticeEntryResolution> {
  const matches = (await repo.listBoards(ctx)).filter((board) => board.source === NOTICE_TAB_SOURCE);
  // #849 — 회사가 지운 탭이면 «고칠 것» 이 아니다.
  if (matches.length === 0) {
    return await isDefaultTabDismissed(ctx, repo, NOTICE_TAB_SOURCE) ? { kind: "dismissed" } : { kind: "missing" };
  }
  if (matches.length > 1) return { kind: "conflict" };
  return { kind: "ready", boardId: matches[0].id };
}

/** Additively repair only the authenticated workspace's notice default tab. */
export async function repairNoticeBoardOnEntry(
  ctx: Ctx,
  client: SupabaseClient,
): Promise<NoticeEntryResolution | { kind: "permission" }> {
  return repairDefaultTabOnEntry(
    ctx,
    client,
    NOTICE_TAB,
    (c, repo: BoardsRepo) => resolveExistingNoticeBoard(c, repo),
  );
}
