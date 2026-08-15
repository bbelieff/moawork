import type { Board } from "@/lib/boards/types";
import { NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import type { Ctx } from "@/lib/types";

export type NoticeEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" };

export interface NoticeBoardsReader {
  listBoards(ctx: Ctx): Promise<Board[]>;
}

/** Resolve the installed product notice tab without mutating data on GET. */
export async function resolveExistingNoticeBoard(
  ctx: Ctx,
  repo: NoticeBoardsReader,
): Promise<NoticeEntryResolution> {
  const matches = (await repo.listBoards(ctx)).filter((board) => board.source === NOTICE_TAB_SOURCE);
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "conflict" };
  return { kind: "ready", boardId: matches[0].id };
}
