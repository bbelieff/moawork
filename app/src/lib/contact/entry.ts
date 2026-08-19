import type { SupabaseClient } from "@supabase/supabase-js";
import type { Board } from "@/lib/boards/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { CONTACT_TAB } from "@/lib/default-tabs/contact";
import { CONTACT_TAB_SOURCE } from "@/lib/default-tabs/types";
import { repairDefaultTabOnEntry } from "@/lib/default-tabs/repair-on-entry";
import type { Ctx } from "@/lib/types";

export type ContactEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" };

export interface ContactBoardsReader {
  listBoards(ctx: Ctx): Promise<Board[]>;
}

/** GET 진입점은 제품 source로 기존 보드를 고를 뿐 생성·이관을 실행하지 않는다. */
export async function resolveExistingContactBoard(
  ctx: Ctx,
  repo: ContactBoardsReader,
): Promise<ContactEntryResolution> {
  const matches = (await repo.listBoards(ctx)).filter((board) => board.source === CONTACT_TAB_SOURCE);
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "conflict" };
  return { kind: "ready", boardId: matches[0].id };
}

/**
 * BBE-236 — `resolveExistingContactBoard` 는 GET 전용(생성 안 함)이라 컨택관리 보드가
 * 아직 없는(기존) 워크스페이스는 영원히 「찾을 수 없습니다」 만 본다. newcust 와 같은
 * additive repair 를 여기도 붙인다 — owner/admin 진입에서만, 고칠 것이 있을 때만.
 */
export async function repairContactBoardOnEntry(
  ctx: Ctx,
  client: SupabaseClient,
): Promise<ContactEntryResolution | { kind: "permission" }> {
  return repairDefaultTabOnEntry(
    ctx,
    client,
    CONTACT_TAB,
    (c, repo: BoardsRepo) => resolveExistingContactBoard(c, repo),
  );
}
