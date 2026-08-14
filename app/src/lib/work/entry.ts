import type { BoardsRepo } from "@/lib/boards/store";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import type { Ctx } from "@/lib/types";

export type ContractWorkEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" };

/** Resolve the product-owned contract-work board without mutating data on GET. */
export async function resolveExistingContractWorkBoard(
  ctx: Ctx,
  repo: BoardsRepo,
): Promise<ContractWorkEntryResolution> {
  const matches = (await repo.listBoards(ctx)).filter(
    (board) => board.source === CONTRACT_WORK_TAB_SOURCE,
  );
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "conflict" };
  return { kind: "ready", boardId: matches[0].id };
}
