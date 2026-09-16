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
