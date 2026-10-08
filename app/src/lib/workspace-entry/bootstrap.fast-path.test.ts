import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardsRepo } from "@/lib/boards/store";
import type { Ctx } from "@/lib/types";

const harness = vi.hoisted(() => ({
  repo: null as BoardsRepo | null,
  summary: vi.fn(),
}));
vi.mock("@/lib/repo/supabase/boardsRepo", () => ({
  SupabaseBoardsRepo: vi.fn(function () { return harness.repo; }),
}));
vi.mock("@/lib/auth/member-org-summary", () => ({ loadMemberOrgSummaryWithClient: harness.summary }));

import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { db, resetDb } from "@/lib/repo/local/store";
import { getRepo } from "@/lib/repo";
import { DEFAULT_TABS, ensureDefaultTabs } from "@/lib/default-tabs";
import { ensureApprovedWorkspaceOnEntry } from "./bootstrap";

const ctx = {
  org: { id: "org-entry-qa", name: "Entry QA", plan_tier: "free", created_at: "2026-09-01" },
  user: { id: "entry-owner", name: "Owner", created_at: "2026-09-01" },
  role: "owner", scope: "all",
} as Ctx;
const assignees = [{ userId: ctx.user.id, displayName: "Owner" }];
let repo: BoardsRepo;

function client(options: { approved?: boolean; denied?: boolean; orgId?: string } = {}) {
  const orgId = options.orgId ?? ctx.org.id;
  const filters: Array<[string, unknown]> = [];
  const query = (data: unknown) => {
    const builder = {
      select: () => builder,
      eq: (name: string, value: unknown) => { filters.push([name, value]); return builder; },
      maybeSingle: async () => ({ data, error: null }),
    };
    return builder;
  };
  return {
    filters,
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: ctx.user.id, created_at: "2026-09-01", user_metadata: {} } }, error: null })) },
    from: vi.fn((table: string) => query(table === "orgs"
      ? { ...ctx.org, id: orgId }
      : options.denied ? null : { role: "owner", scope: "all", status: "active" })),
    rpc: vi.fn(async (name: string) => ({ data: name === "is_my_approved_workspace_creator" ? options.approved !== false : true, error: null })),
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  resetDb();
  getRepo().addMember(ctx.org.id, {
    id: ctx.user.id, name: "Owner", email: "owner@example.test", avatar_url: null, created_at: "2026-09-01",
  }, "owner", "all");
  repo = toAsyncBoardsRepo(new LocalBoardsRepo());
  await ensureDefaultTabs(ctx, repo, assignees);
  harness.repo = repo;
  harness.summary.mockReset().mockResolvedValue({
    kind: "ready", owner: assignees[0], admins: [], members: [],
  });
});

describe("approved workspace repeat entry", () => {
  it("checks real installed structure without a lease or writes, and rechecks each new request", async () => {
    const list = vi.spyOn(repo, "listBoards");
    const writeState = vi.spyOn(repo, "setDefaultDefinitionState");
    const updateColumn = vi.spyOn(repo, "updateColumn");
    const request = client();
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa");
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa");
    expect(request.auth.getUser).toHaveBeenCalledTimes(2);
    expect(request.from.mock.calls.filter(([table]) => table === "orgs")).toHaveLength(2);
    expect(list).toHaveBeenCalledTimes(2);
    expect(request.rpc.mock.calls.map(([name]) => name)).toEqual([
      "is_my_approved_workspace_creator", "is_my_approved_workspace_creator",
    ]);
    expect(writeState).not.toHaveBeenCalled();
    expect(updateColumn).not.toHaveBeenCalled();
  });

  it("repairs a missing column under the existing lease", async () => {
    const board = (await repo.listBoards(ctx)).find((row) => row.source === DEFAULT_TABS[0].source)!;
    const removed = (await repo.listColumns(ctx, board.id))[0];
    // An interrupted initial install, not a user's intentional archived column.
    db().boardColumns = db().boardColumns.filter((row) => row.id !== removed.id);
    const request = client();
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa");
    expect((await repo.listColumns(ctx, board.id)).some((row) => row.key === removed.key)).toBe(true);
    expect(request.rpc.mock.calls.map(([name]) => name)).toContain("acquire_workspace_bootstrap_lease");
    expect(request.rpc.mock.calls.map(([name]) => name)).toContain("release_workspace_bootstrap_lease");
  });

  it("repairs a missing board rather than accepting the remaining board shells", async () => {
    const board = (await repo.listBoards(ctx))[0];
    await repo.deleteBoard(ctx, board.id);
    const request = client();
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa");
    expect(await repo.listBoards(ctx)).toHaveLength(DEFAULT_TABS.length);
    expect(request.rpc.mock.calls.map(([name]) => name)).toContain("acquire_workspace_bootstrap_lease");
  });

  it("#849 counts a trashed default tab as clean — no lease, no recreation", async () => {
    const trashed = (await repo.listBoards(ctx)).find((row) => row.source === DEFAULT_TABS[1].source)!;
    await repo.trashBoard(ctx, trashed.id);
    const create = vi.spyOn(repo, "createBoard");
    const request = client();
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa");
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa");
    expect(request.rpc.mock.calls.map(([name]) => name)).not.toContain("acquire_workspace_bootstrap_lease");
    expect(create).not.toHaveBeenCalled();
    expect((await repo.listBoards(ctx)).some((row) => row.source === DEFAULT_TABS[1].source)).toBe(false);
  });

  it("#849 repairs a lost default tab under the lease but leaves the trashed one alone", async () => {
    const boards = await repo.listBoards(ctx);
    const trashed = boards.find((row) => row.source === DEFAULT_TABS[1].source)!;
    const lost = boards.find((row) => row.source === DEFAULT_TABS[2].source)!;
    await repo.trashBoard(ctx, trashed.id);
    await repo.deleteBoard(ctx, lost.id);
    const request = client();
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa");
    const sources = (await repo.listBoards(ctx)).map((row) => row.source);
    expect(sources).toContain(DEFAULT_TABS[2].source);
    expect(sources).not.toContain(DEFAULT_TABS[1].source);
    expect(request.rpc.mock.calls.map(([name]) => name)).toContain("acquire_workspace_bootstrap_lease");
  });

  it("does not read dismissals when every default tab is present", async () => {
    const reads = vi.spyOn(repo, "listDefaultTabDismissals");
    await ensureApprovedWorkspaceOnEntry(client() as never, "entry-qa");
    expect(reads).not.toHaveBeenCalled();
  });

  it("falls back to the guarded path when the read-only probe fails", async () => {
    vi.spyOn(repo, "listBoards").mockRejectedValueOnce(new Error("read unavailable"));
    const request = client();
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa");
    expect(request.rpc.mock.calls.map(([name]) => name)).toContain("acquire_workspace_bootstrap_lease");
  });

  it("does not reuse a previous request's membership when access is revoked", async () => {
    await ensureApprovedWorkspaceOnEntry(client() as never, "entry-qa");
    const list = vi.spyOn(repo, "listBoards");
    const request = client({ denied: true });
    await expect(ensureApprovedWorkspaceOnEntry(request as never, "entry-qa")).rejects.toThrow("membership unavailable");
    expect(list).not.toHaveBeenCalled();
    expect(request.filters).toContainEqual(["org_id", ctx.org.id]);
    expect(request.filters).toContainEqual(["user_id", ctx.user.id]);
    expect(request.filters).toContainEqual(["status", "active"]);
  });

  it("does not inspect or modify an unapproved legacy workspace", async () => {
    const list = vi.spyOn(repo, "listBoards");
    const request = client({ approved: false });
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa");
    expect(list).not.toHaveBeenCalled();
    expect(harness.summary).not.toHaveBeenCalled();
  });

  it("binds a different workspace to its own membership check", async () => {
    const list = vi.spyOn(repo, "listBoards");
    const request = client({ orgId: "org-other-qa", denied: true });
    await expect(ensureApprovedWorkspaceOnEntry(request as never, "other-qa")).rejects.toThrow("membership unavailable");
    expect(request.filters).toContainEqual(["org_id", "org-other-qa"]);
    expect(list).not.toHaveBeenCalled();
    expect(await repo.listBoards(ctx)).toHaveLength(DEFAULT_TABS.length);
  });
});

describe("Issue 857 — 이 요청에서 검증된 세션을 넘기면", () => {
  it("getUser·회사·멤버십을 다시 읽지 않고, 승인 확인은 세션의 회사로 한다", async () => {
    const request = client();
    await ensureApprovedWorkspaceOnEntry(request as never, "entry-qa", { ctx });
    expect(request.auth.getUser).not.toHaveBeenCalled();
    expect(request.from).not.toHaveBeenCalled();
    expect(request.rpc).toHaveBeenCalledWith("is_my_approved_workspace_creator", { p_org_id: ctx.org.id });
  });

  it("담당자 목록과 보드 목록을 같이 출발시킨다", async () => {
    let releaseSummary!: () => void;
    harness.summary.mockReset().mockImplementation(() => new Promise((resolve) => {
      releaseSummary = () => resolve({ kind: "ready", owner: assignees[0], admins: [], members: [] });
    }));
    const list = vi.spyOn(repo, "listBoards");
    const entry = ensureApprovedWorkspaceOnEntry(client() as never, "entry-qa", { ctx });
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    releaseSummary();
    await entry;
    expect(harness.summary).toHaveBeenCalledTimes(1);
  });

  it("승인된 만든이가 아니면 아무것도 읽지 않고 끝난다", async () => {
    const list = vi.spyOn(repo, "listBoards");
    await ensureApprovedWorkspaceOnEntry(client({ approved: false }) as never, "entry-qa", { ctx });
    expect(list).not.toHaveBeenCalled();
    expect(harness.summary).not.toHaveBeenCalled();
  });

  it("담당자 목록을 못 읽으면 예전처럼 «준비 못 함» 으로 닫힌다", async () => {
    harness.summary.mockReset().mockResolvedValue({ kind: "error" });
    await expect(ensureApprovedWorkspaceOnEntry(client() as never, "entry-qa", { ctx })).rejects.toThrow(/assignees unavailable/);
  });

  it("고칠 것이 없으면 clean, 승인된 만든이가 아니면 skipped 를 돌려준다", async () => {
    await expect(ensureApprovedWorkspaceOnEntry(client() as never, "entry-qa", { ctx })).resolves.toBe("clean");
    await expect(ensureApprovedWorkspaceOnEntry(client({ approved: false }) as never, "entry-qa", { ctx })).resolves.toBe("skipped");
  });
});
