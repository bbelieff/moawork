import type { Ctx } from "@/lib/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { NEW_LEAD_TAB } from "@/lib/default-tabs/new-lead";
import { ensureDefaultTabAdditive } from "@/lib/default-tabs/install";
import { assigneesFromMemberSummary } from "@/lib/boards/default-tab-assignees";
import { loadMemberOrgSummaryWithClient } from "@/lib/auth/member-org-summary";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import type { SupabaseClient } from "@supabase/supabase-js";

export type NewcustEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "permission" };

export const NEWCUST_BOARD_SOURCE = NEW_LEAD_TAB_SOURCE;
const REPAIR_LEASE_ATTEMPTS = 40;
const REPAIR_LEASE_WAIT_MS = 250;
const REPAIR_LEASE_HEARTBEAT_MS = 10_000;

/**
 * 현재 조직의 기존 031 신규업체 보드를 유일하게 찾는다.
 *
 * GET 진입점은 조회·이동만 한다. 구조 팩 설치는 owner-only로 별도 승인된 경로에서만
 * 수행해야 하며, 마지막 방문 기록이나 query/cookie는 보드 권한·선택 근거로 쓰지 않는다.
 */
export async function resolveExistingNewcustBoard(
  ctx: Ctx,
  repo: BoardsRepo,
): Promise<NewcustEntryResolution> {
  const matches = (await repo.listBoards(ctx)).filter(
    (board) => board.source === NEWCUST_BOARD_SOURCE,
  );
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "conflict" };
  return { kind: "ready", boardId: matches[0].id };
}

/** Production entry repair for exactly the authenticated workspace in `ctx`. */
export async function repairNewcustBoardOnEntry(
  ctx: Ctx,
  client: SupabaseClient,
): Promise<NewcustEntryResolution> {
  const repo = new SupabaseBoardsRepo(client);
  const existing = await resolveExistingNewcustBoard(ctx, repo);
  if (existing.kind === "conflict") return existing;
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return existing.kind === "ready" ? existing : { kind: "permission" };
  }

  const summary = await loadMemberOrgSummaryWithClient(client, ctx);
  const assignees = assigneesFromMemberSummary(summary);
  if (summary.kind !== "ready" || assignees.length === 0) {
    throw new Error("newcust repair members unavailable");
  }

  const holder = crypto.randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < REPAIR_LEASE_ATTEMPTS; attempt += 1) {
    const result = await client.rpc("acquire_default_tab_repair_lease", {
      p_org_id: ctx.org.id,
      p_holder: holder,
    });
    if (result.error) throw new Error("newcust repair lease unavailable");
    if (result.data === true) {
      acquired = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, REPAIR_LEASE_WAIT_MS));
  }
  if (!acquired) throw new Error("newcust repair lease unavailable");

  let leaseLost = false;
  let renewing = false;
  const renew = async () => {
    if (leaseLost) throw new Error("newcust repair lease lost");
    const result = await client.rpc("renew_default_tab_repair_lease", {
      p_org_id: ctx.org.id,
      p_holder: holder,
    });
    if (result.error || result.data !== true) {
      leaseLost = true;
      throw new Error("newcust repair lease lost");
    }
  };
  const heartbeat = setInterval(() => {
    if (renewing || leaseLost) return;
    renewing = true;
    void renew().catch(() => undefined).finally(() => { renewing = false; });
  }, REPAIR_LEASE_HEARTBEAT_MS);

  try {
    await renew();
    const before = await resolveExistingNewcustBoard(ctx, repo);
    if (before.kind === "conflict") return before;
    const ensured = await ensureDefaultTabAdditive(ctx, NEW_LEAD_TAB, repo, assignees);
    await renew();
    return { kind: "ready", boardId: ensured.boardId };
  } finally {
    clearInterval(heartbeat);
    const released = await client.rpc("release_default_tab_repair_lease", {
      p_org_id: ctx.org.id,
      p_holder: holder,
    });
    if (released.error || released.data !== true) {
      throw new Error("newcust repair lease release unavailable");
    }
  }
}
