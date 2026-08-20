import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_WORK_TAB, CONTRACT_WORK_TAB_SOURCE, ensureDefaultTab } from "@/lib/default-tabs";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import type { Ctx } from "@/lib/types";
import { resetDb } from "@/lib/repo/local/store";

// BBE-236 — newcust/entry.test.ts 와 같은 계약.
const { loadMemberOrgSummaryWithClient } = vi.hoisted(() => ({
  loadMemberOrgSummaryWithClient: vi.fn(),
}));
vi.mock("@/lib/auth/member-org-summary", () => ({ loadMemberOrgSummaryWithClient }));
vi.mock("@/lib/repo/supabase/boardsRepo", () => ({
  SupabaseBoardsRepo: class {
    constructor(client: { repo: Record<PropertyKey, unknown> }) {
      return new Proxy(this, { get: (_target, property) => client.repo[property] });
    }
  },
}));

import { repairContractWorkBoardOnEntry, resolveExistingContractWorkBoard } from "./entry";

const ctx = {
  org: { id: "org-work-entry", name: "Test organization" },
  user: { id: "owner-work-entry", name: "Owner", email: "owner@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

beforeEach(() => {
  resetDb();
  loadMemberOrgSummaryWithClient.mockReset().mockResolvedValue({
    kind: "ready",
    owner: { userId: ctx.user.id, displayName: ctx.user.name },
    admins: [],
    members: [],
  });
});

describe("resolveExistingContractWorkBoard", () => {
  it("selects exactly one board by product source", async () => {
    const local = new LocalBoardsRepo();
    const target = local.createBoard(ctx, { name: "Renamed board", source: CONTRACT_WORK_TAB_SOURCE });
    expect(await resolveExistingContractWorkBoard(ctx, toAsyncBoardsRepo(local))).toEqual({
      kind: "ready",
      boardId: target.id,
    });
  });

  it("does not adopt legacy or same-name boards", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: CONTRACT_WORK_TAB.name, source: null });
    local.createBoard(ctx, { name: CONTRACT_WORK_TAB.name, source: "pack.seoul.policyfund1/work" });
    expect(await resolveExistingContractWorkBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "missing" });
  });

  it("fails closed when the product source is duplicated", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: "A", source: CONTRACT_WORK_TAB_SOURCE });
    local.createBoard(ctx, { name: "B", source: CONTRACT_WORK_TAB_SOURCE });
    expect(await resolveExistingContractWorkBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "conflict" });
  });

  it("resolves the board created by the default installer", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const installed = await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, repo);
    expect(await resolveExistingContractWorkBoard(ctx, repo)).toEqual({
      kind: "ready",
      boardId: installed.boardId,
    });
  });
});

// BBE-236 — 계약업체 실무 보드가 없으면 BBE-235 트리거(업무관리 이동 → 투영)도 무력하다.
describe("repairContractWorkBoardOnEntry", () => {
  function fakeClient(repo: ReturnType<typeof toAsyncBoardsRepo>) {
    let holder: string | null = null;
    return {
      repo,
      rpc: vi.fn(async (name: string, args: { p_holder: string }) => {
        if (name === "acquire_default_tab_repair_lease") {
          if (holder === null || holder === args.p_holder) { holder = args.p_holder; return { data: true, error: null }; }
          return { data: false, error: null };
        }
        if (name === "renew_default_tab_repair_lease") return { data: holder === args.p_holder, error: null };
        if (holder === args.p_holder) holder = null;
        return { data: true, error: null };
      }),
    };
  }

  it("member는 없는 보드를 못 고친다", async () => {
    const request = fakeClient(toAsyncBoardsRepo(new LocalBoardsRepo()));
    const result = await repairContractWorkBoardOnEntry({ ...ctx, role: "member", scope: "assigned" }, request as never);
    expect(result).toEqual({ kind: "permission" });
    expect(request.rpc).not.toHaveBeenCalled();
  });

  it("owner 진입에서 없는 보드가 additive로 생기고, 수수료 컬럼까지 포함한다", async () => {
    const local = new LocalBoardsRepo();
    const request = fakeClient(toAsyncBoardsRepo(local));
    const result = await repairContractWorkBoardOnEntry(ctx, request as never);
    expect(result.kind).toBe("ready");
    const boardId = result.kind === "ready" ? result.boardId : "";
    expect(local.listColumns(ctx, boardId).some((c) => c.key === "fee_percent")).toBe(true);
  });

  it("동시 진입 2회에도 보드가 하나로 수렴한다", async () => {
    const local = new LocalBoardsRepo();
    const request = fakeClient(toAsyncBoardsRepo(local));
    const [first, second] = await Promise.all([
      repairContractWorkBoardOnEntry(ctx, request as never),
      repairContractWorkBoardOnEntry(ctx, request as never),
    ]);
    expect(first).toEqual(second);
    expect(local.listBoards(ctx).filter((b) => b.source === CONTRACT_WORK_TAB_SOURCE)).toHaveLength(1);
  });
});
