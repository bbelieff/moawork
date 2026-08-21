import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_TAB, ensureDefaultTab } from "@/lib/default-tabs";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { db, resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
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

import { repairNoticeBoardOnEntry, resolveExistingNoticeBoard } from "./entry";

const ctx = {
  org: { id: "org-notice-entry", name: "테스트 회사" },
  user: { id: "owner", name: "만든 사람", email: "owner@example.test" },
  role: "owner",
  scope: "all",
} as Ctx;

beforeEach(() => {
  resetDb();
  loadMemberOrgSummaryWithClient.mockReset().mockResolvedValue({
    kind: "ready",
    owner: { userId: ctx.user.id, displayName: ctx.user.name },
    admins: [],
    members: [],
  });
});

describe("BBE-151 notice product entry", () => {
  it("finds the one board installed from the notice default tab", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const installed = await ensureDefaultTab(ctx, NOTICE_TAB, repo);
    expect(await resolveExistingNoticeBoard(ctx, repo)).toEqual({
      kind: "ready",
      boardId: installed.boardId,
    });
  });

  it("keeps missing and duplicate product sources explicit", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    expect(await resolveExistingNoticeBoard(ctx, repo)).toEqual({ kind: "missing" });
    await local.createBoard(ctx, { name: "공지 1", source: NOTICE_TAB.source });
    await local.createBoard(ctx, { name: "공지 2", source: NOTICE_TAB.source });
    expect(await resolveExistingNoticeBoard(ctx, repo)).toEqual({ kind: "conflict" });
  });
});

describe("BBE-236 notice entry additive repair", () => {
  function fakeClient(repo: ReturnType<typeof toAsyncBoardsRepo>) {
    let holder: string | null = null;
    return {
      repo,
      rpc: vi.fn(async (name: string, args: { p_holder: string }) => {
        if (name === "acquire_default_tab_repair_lease") {
          if (holder === null || holder === args.p_holder) {
            holder = args.p_holder;
            return { data: true, error: null };
          }
          return { data: false, error: null };
        }
        if (name === "renew_default_tab_repair_lease") {
          return { data: holder === args.p_holder, error: null };
        }
        if (holder === args.p_holder) holder = null;
        return { data: true, error: null };
      }),
    };
  }

  it("owner entry creates the missing tab and concurrent entry converges on one board", async () => {
    const local = new LocalBoardsRepo();
    const request = fakeClient(toAsyncBoardsRepo(local));
    const [first, second] = await Promise.all([
      repairNoticeBoardOnEntry(ctx, request as never),
      repairNoticeBoardOnEntry(ctx, request as never),
    ]);
    expect(first).toEqual(second);
    expect(local.listBoards(ctx).filter((board) => board.source === NOTICE_TAB.source)).toHaveLength(1);
  });

  it("partially repairs only missing structure and preserves rows, values, and another board", async () => {
    const local = new LocalBoardsRepo();
    const partial = local.createBoard(ctx, { name: "사용자 이름", source: NOTICE_TAB.source });
    const group = local.createGroup(ctx, partial.id, { name: NOTICE_TAB.groups[0].name, color: "#custom" });
    local.createColumn(ctx, partial.id, {
      key: NOTICE_TAB.columns[0].key,
      label: "사용자 대상",
      type: NOTICE_TAB.columns[0].type,
      source: NOTICE_TAB.columns[0].source,
    });
    const item = local.createItem(ctx, partial.id, {
      group_id: group.id,
      title: "보존 행",
      values: { [NOTICE_TAB.columns[0].key]: 0 },
    });
    const beforeItems = structuredClone(db().boardItems);
    const beforeValues = structuredClone(db().itemValues);
    const other = local.createBoard(ctx, { name: "다른 보드", source: "customer.other" });
    const beforeOther = structuredClone(local.getBoard(ctx, other.id));

    const result = await repairNoticeBoardOnEntry(ctx, fakeClient(toAsyncBoardsRepo(local)) as never);

    expect(result).toEqual({ kind: "ready", boardId: partial.id });
    expect(local.getBoard(ctx, other.id)).toEqual(beforeOther);
    expect(local.getItem(ctx, item.id)).toEqual(expect.objectContaining({ id: item.id, title: "보존 행" }));
    expect(db().boardItems).toEqual(beforeItems);
    expect(db().itemValues).toEqual(beforeValues);
    expect(local.getBoard(ctx, partial.id)?.name).toBe("사용자 이름");
    expect(local.listGroups(ctx, partial.id).find(({ id }) => id === group.id)?.color).toBe("#custom");
    expect(local.listColumns(ctx, partial.id).find(({ key }) => key === NOTICE_TAB.columns[0].key)?.label)
      .toBe("사용자 대상");
    expect(local.listGroups(ctx, partial.id)).toHaveLength(NOTICE_TAB.groups.length);
    expect(local.listColumns(ctx, partial.id)).toHaveLength(NOTICE_TAB.columns.length);
  });

  it("member cannot create a missing tab and failures remain explicit", async () => {
    const request = fakeClient(toAsyncBoardsRepo(new LocalBoardsRepo()));
    await expect(repairNoticeBoardOnEntry({ ...ctx, role: "member" }, request as never))
      .resolves.toEqual({ kind: "permission" });
    expect(request.rpc).not.toHaveBeenCalled();

    loadMemberOrgSummaryWithClient.mockResolvedValueOnce({ kind: "unavailable" });
    await expect(repairNoticeBoardOnEntry(ctx, request as never))
      .rejects.toThrow("default tab repair members unavailable");
  });
});
