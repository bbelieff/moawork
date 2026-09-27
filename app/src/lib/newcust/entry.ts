import type { Ctx } from "@/lib/types";
import type { Board } from "@/lib/boards/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { NEW_LEAD_TAB } from "@/lib/default-tabs/new-lead";
import { ensureDefaultTabAdditive, readDefaultTabBoardDrift } from "@/lib/default-tabs/install";
import { assigneesFromMemberSummary } from "@/lib/boards/default-tab-assignees";
import { loadMemberOrgSummaryWithClient } from "@/lib/auth/member-org-summary";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import type { SupabaseClient } from "@supabase/supabase-js";

export type NewcustEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "permission" };

type ExistingNewcustBoard =
  | { kind: "ready"; board: Board }
  | { kind: "missing" }
  | { kind: "conflict" };

export const NEWCUST_BOARD_SOURCE = NEW_LEAD_TAB_SOURCE;
const REPAIR_LEASE_ATTEMPTS = 40;
const REPAIR_LEASE_WAIT_MS = 250;
const REPAIR_LEASE_HEARTBEAT_MS = 10_000;

async function readExistingNewcustBoard(
  ctx: Ctx,
  repo: BoardsRepo,
): Promise<ExistingNewcustBoard> {
  const matches = (await repo.listBoards(ctx)).filter(
    (board) => board.source === NEWCUST_BOARD_SOURCE,
  );
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "conflict" };
  return { kind: "ready", board: matches[0] };
}

function toEntryResolution(selection: ExistingNewcustBoard): NewcustEntryResolution {
  return selection.kind === "ready"
    ? { kind: "ready", boardId: selection.board.id }
    : selection;
}

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
  return toEntryResolution(await readExistingNewcustBoard(ctx, repo));
}

/** Production entry repair for exactly the authenticated workspace in `ctx`. */
export async function repairNewcustBoardOnEntry(
  ctx: Ctx,
  client: SupabaseClient,
): Promise<NewcustEntryResolution> {
  const repo = new SupabaseBoardsRepo(client);
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    const existing = await readExistingNewcustBoard(ctx, repo);
    if (existing.kind === "conflict") return existing;
    return existing.kind === "ready" ? toEntryResolution(existing) : { kind: "permission" };
  }

  // Board identity and member-derived assignee input are independent reads. Keep
  // both request-local, then preserve board conflict as the first authoritative
  // outcome even if the concurrent member read fails.
  const [existingResult, summaryResult] = await Promise.allSettled([
    readExistingNewcustBoard(ctx, repo),
    loadMemberOrgSummaryWithClient(client, ctx),
  ]);
  if (existingResult.status === "rejected") throw existingResult.reason;
  const existing = existingResult.value;
  if (existing.kind === "conflict") return existing;
  if (summaryResult.status === "rejected") throw summaryResult.reason;
  const summary = summaryResult.value;
  const assignees = assigneesFromMemberSummary(summary);
  if (summary.kind !== "ready" || assignees.length === 0) {
    throw new Error("newcust repair members unavailable");
  }

  // ★ BBE-214 — 고칠 것이 없으면 리스를 잡지 않는다.
  //
  //   실측: owner 가 이 탭을 열 때마다 왕복 14회 · 리스 RPC 4회를 치렀는데
  //   **정상 워크스페이스에서는 구조 쓰기가 0회** 였다. 분산 락을 잡고 아무것도 안 고치고 놓았다.
  //   멤버는 위 role 검사에서 조기 반환하므로 이 값을 owner/admin 만 냈다.
  //
  //   ⚠ 이것은 «건너뛰기» 전용 판정이다. 치유를 약하게 만들지 않는다:
  //     조금이라도 만들 것이 있으면 아래 리스 경로로 그대로 내려가고,
  //     **쓰기는 여전히 리스 «안에서» 다시 읽고 다시 판정한 뒤에만** 일어난다.
  //     즉 여기서 잘못 «있다» 고 말하면 예전과 똑같이 동작할 뿐이고,
  //     «없다» 고 말할 수 있는 경우는 읽은 순간 정말로 빠진 것이 없을 때뿐이다.
  if (existing.kind === "ready") {
    const drift = await readDefaultTabBoardDrift(ctx, NEW_LEAD_TAB, existing.board, repo, assignees);
    if (!drift.hasWork) return toEntryResolution(existing);
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
