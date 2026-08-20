import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import type { BoardsRepo } from "@/lib/boards/store";
import type { DefaultTab } from "./types";
import { ensureDefaultTabAdditive, readDefaultTabDrift } from "./install";
import { assigneesFromMemberSummary } from "@/lib/boards/default-tab-assignees";
import { loadMemberOrgSummaryWithClient } from "@/lib/auth/member-org-summary";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";

export type DefaultTabEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "permission" };

const REPAIR_LEASE_ATTEMPTS = 40;
const REPAIR_LEASE_WAIT_MS = 250;
const REPAIR_LEASE_HEARTBEAT_MS = 10_000;

/**
 * BBE-236 — `repairNewcustBoardOnEntry`(app/src/lib/newcust/entry.ts)와 «같은 로직» 을
 * 탭 무관하게 뽑아낸 것이다. 신규리드 전용 파일은 이미 검수·테스트가 끝난 상태라
 * 손대지 않았다 — 이 파일은 그 옆에 «같은 계약» 으로 새로 추가한 것이다.
 *
 * 컨택관리 · 계약업체 실무 두 진입점이 이걸 쓴다. 공지사항은 이미 자기 원자적 RPC
 * (`bbe151_ensure_notice_tab`, PostgreSQL advisory lock)가 있어 여기 안 낀다 —
 * BBE-236 이 처음 「3개 다 없다」고 적었던 것은 부정확했다: 실은 2개였다.
 */
export async function repairDefaultTabOnEntry(
  ctx: Ctx,
  client: SupabaseClient,
  tab: DefaultTab,
  resolveExisting: (ctx: Ctx, repo: BoardsRepo) => Promise<DefaultTabEntryResolution>,
): Promise<DefaultTabEntryResolution> {
  const repo = new SupabaseBoardsRepo(client);
  const existing = await resolveExisting(ctx, repo);
  if (existing.kind === "conflict") return existing;
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return existing.kind === "ready" ? existing : { kind: "permission" };
  }

  const summary = await loadMemberOrgSummaryWithClient(client, ctx);
  const assignees = assigneesFromMemberSummary(summary);
  if (summary.kind !== "ready" || assignees.length === 0) {
    throw new Error("default tab repair members unavailable");
  }

  // BBE-214 와 같은 이유 — 고칠 것이 없으면 리스를 잡지 않는다.
  if (existing.kind === "ready") {
    const drift = await readDefaultTabDrift(ctx, tab, repo, assignees);
    if (!drift.hasWork) return existing;
  }

  const holder = crypto.randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < REPAIR_LEASE_ATTEMPTS; attempt += 1) {
    const result = await client.rpc("acquire_default_tab_repair_lease", {
      p_org_id: ctx.org.id,
      p_holder: holder,
    });
    if (result.error) throw new Error("default tab repair lease unavailable");
    if (result.data === true) {
      acquired = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, REPAIR_LEASE_WAIT_MS));
  }
  if (!acquired) throw new Error("default tab repair lease unavailable");

  let leaseLost = false;
  let renewing = false;
  const renew = async () => {
    if (leaseLost) throw new Error("default tab repair lease lost");
    const result = await client.rpc("renew_default_tab_repair_lease", {
      p_org_id: ctx.org.id,
      p_holder: holder,
    });
    if (result.error || result.data !== true) {
      leaseLost = true;
      throw new Error("default tab repair lease lost");
    }
  };
  const heartbeat = setInterval(() => {
    if (renewing || leaseLost) return;
    renewing = true;
    void renew().catch(() => undefined).finally(() => { renewing = false; });
  }, REPAIR_LEASE_HEARTBEAT_MS);

  try {
    await renew();
    const before = await resolveExisting(ctx, repo);
    if (before.kind === "conflict") return before;
    const ensured = await ensureDefaultTabAdditive(ctx, tab, repo, assignees);
    await renew();
    return { kind: "ready", boardId: ensured.boardId };
  } finally {
    clearInterval(heartbeat);
    const released = await client.rpc("release_default_tab_repair_lease", {
      p_org_id: ctx.org.id,
      p_holder: holder,
    });
    if (released.error || released.data !== true) {
      throw new Error("default tab repair lease release unavailable");
    }
  }
}
