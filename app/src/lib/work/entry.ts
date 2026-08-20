import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardsRepo } from "@/lib/boards/store";
import { CONTRACT_WORK_TAB, CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { repairDefaultTabOnEntry } from "@/lib/default-tabs/repair-on-entry";
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

/**
 * BBE-236 — 계약업체 실무 보드가 없는(기존) 워크스페이스를 위한 additive repair.
 * `resolveExistingContractWorkBoard` 는 GET 전용이라 여기 붙이지 않으면 영원히 안 생긴다.
 * 오늘 만든 BBE-235 트리거(「업무관리 이동」→ 실무 보드 투영)도 이 보드가 있어야
 * 작동한다 — 이 함수가 그 전제를 채운다.
 */
export async function repairContractWorkBoardOnEntry(
  ctx: Ctx,
  client: SupabaseClient,
): Promise<ContractWorkEntryResolution | { kind: "permission" }> {
  return repairDefaultTabOnEntry(
    ctx,
    client,
    CONTRACT_WORK_TAB,
    (c, repo: BoardsRepo) => resolveExistingContractWorkBoard(c, repo),
  );
}
