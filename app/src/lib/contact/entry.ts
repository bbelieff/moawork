import type { BoardsRepo } from "@/lib/boards/store";
import { CONTACT_TAB_SOURCE } from "@/lib/default-tabs/types";
import type { Ctx } from "@/lib/types";

export type ContactEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" };

/** GET 진입점은 제품 source로 기존 보드를 고를 뿐 생성·이관을 실행하지 않는다. */
export async function resolveExistingContactBoard(
  ctx: Ctx,
  repo: BoardsRepo,
): Promise<ContactEntryResolution> {
  const matches = (await repo.listBoards(ctx)).filter((board) => board.source === CONTACT_TAB_SOURCE);
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "conflict" };
  return { kind: "ready", boardId: matches[0].id };
}
