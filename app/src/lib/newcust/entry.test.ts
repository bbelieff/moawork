import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { ensureDefaultTab, NEW_LEAD_TAB } from "@/lib/default-tabs";

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

import { NEWCUST_BOARD_SOURCE, repairNewcustBoardOnEntry, resolveExistingNewcustBoard } from "./entry";

function owner(): Ctx {
  return {
    user: { id: SEED_USER_OWNER, email: "owner@example.test", name: "owner", avatar_url: null, created_at: "" },
    org: { id: "org-newcust-entry-test", name: "example", plan_tier: "t1_3", created_at: "" },
    role: "owner",
    scope: "all",
  } as Ctx;
}

beforeEach(() => {
  resetDb();
  loadMemberOrgSummaryWithClient.mockReset().mockResolvedValue({
    kind: "ready",
    owner: { userId: SEED_USER_OWNER, displayName: "Owner" },
    admins: [],
    members: [],
  });
});

describe("resolveExistingNewcustBoard", () => {
  it("제품 경로에서 이름이 같은 보드를 먼데이 원본으로 추론하지 않는다", async () => {
    const ctx = owner();
    const repo = new LocalBoardsRepo();
    repo.createBoard(ctx, { name: "🔥신규고객" });
    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(repo))).toEqual({ kind: "missing" });
  });

  it("source 식별자가 유일하면 해당 보드를 연다", async () => {
    const ctx = owner();
    const repo = new LocalBoardsRepo();
    const target = repo.createBoard(ctx, { name: "이름 무관", source: NEWCUST_BOARD_SOURCE });
    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(repo))).toEqual({ kind: "ready", boardId: target.id });
  });

  it("source 식별자가 중복이면 임의 선택하지 않는다", async () => {
    const ctx = owner();
    const repo = new LocalBoardsRepo();
    repo.createBoard(ctx, { name: "A", source: NEWCUST_BOARD_SOURCE });
    repo.createBoard(ctx, { name: "B", source: NEWCUST_BOARD_SOURCE });
    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(repo))).toEqual({ kind: "conflict" });
  });

  it("호출해도 구조 레코드를 만들지 않는다", async () => {
    const ctx = owner();
    const repo = new LocalBoardsRepo();
    const before = repo.listBoards(ctx);
    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(repo))).toEqual({ kind: "missing" });
    expect(repo.listBoards(ctx)).toEqual(before);
  });
  it("D76 기본 탭을 심으면 안정 source로 즉시 진입한다", async () => {
    const ctx = owner();
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const { boardId } = await ensureDefaultTab(ctx, NEW_LEAD_TAB, repo);

    expect(await resolveExistingNewcustBoard(ctx, repo)).toEqual({ kind: "ready", boardId });
    expect(local.listBoards(ctx).find((board) => board.id === boardId)?.source).toBe(
      NEWCUST_BOARD_SOURCE,
    );
  });

  it("legacy 이름만 같은 보드는 제품 기본 탭으로 오인하지 않는다", async () => {
    const ctx = owner();
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: NEW_LEAD_TAB.name, source: null });

    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(local))).toEqual({
      kind: "missing",
    });
  });

  it("역사 structure-pack source만 있는 보드는 제품 기본 탭으로 오인하지 않는다", async () => {
    const ctx = owner();
    const local = new LocalBoardsRepo();
    expect(NEWCUST_BOARD_SOURCE).not.toBe("pack.seoul.policyfund1/newcust");
    local.createBoard(ctx, {
      name: NEW_LEAD_TAB.name,
      source: "pack.seoul.policyfund1/newcust",
    });

    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(local))).toEqual({
      kind: "missing",
    });
  });

  it("로컬 seed의 제품 기본 탭은 즉시 진입 가능하다", async () => {
    const ctx = { ...owner(), org: { ...owner().org, id: SEED_ORG_ID } };
    const local = new LocalBoardsRepo();
    const productBoard = local
      .listBoards(ctx)
      .find((board) => board.source === NEWCUST_BOARD_SOURCE);

    expect(productBoard).toBeDefined();
    expect(await resolveExistingNewcustBoard(ctx, toAsyncBoardsRepo(local))).toEqual({
      kind: "ready",
      boardId: productBoard?.id,
    });
  });
});

describe("repairNewcustBoardOnEntry", () => {
  function client(repo: ReturnType<typeof toAsyncBoardsRepo>) {
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

  function countedRepo(repo: ReturnType<typeof toAsyncBoardsRepo>) {
    const reads = {
      listBoards: vi.fn(repo.listBoards.bind(repo)),
      listGroups: vi.fn(repo.listGroups.bind(repo)),
      listColumns: vi.fn(repo.listColumns.bind(repo)),
      getDefaultDefinitionState: vi.fn(repo.getDefaultDefinitionState?.bind(repo)),
    };
    return {
      reads,
      repo: new Proxy(repo, {
        get(target, property, receiver) {
          if (property in reads) return reads[property as keyof typeof reads];
          return Reflect.get(target, property, receiver);
        },
      }),
    };
  }

  it("does not mutate for a member and returns a clear permission result", async () => {
    const repo = toAsyncBoardsRepo(new LocalBoardsRepo());
    const request = client(repo);
    const result = await repairNewcustBoardOnEntry({ ...owner(), role: "member", scope: "assigned" }, request as never);
    expect(result).toEqual({ kind: "permission" });
    expect(request.rpc).not.toHaveBeenCalled();
    expect(await repo.listBoards(owner())).toEqual([]);
  });

  it("lets a member enter an existing canonical board without acquiring a mutation lease", async () => {
    const local = new LocalBoardsRepo();
    const board = local.createBoard(owner(), { name: "신규리드", source: NEWCUST_BOARD_SOURCE });
    const counted = countedRepo(toAsyncBoardsRepo(local));
    const request = client(counted.repo);
    const result = await repairNewcustBoardOnEntry(
      { ...owner(), role: "member", scope: "assigned" },
      request as never,
    );
    expect(result).toEqual({ kind: "ready", boardId: board.id });
    expect(counted.reads.listBoards).toHaveBeenCalledTimes(1);
    expect(loadMemberOrgSummaryWithClient).not.toHaveBeenCalled();
    expect(request.rpc).not.toHaveBeenCalled();
  });

  it.each(["member", "team_lead"] as const)(
    "keeps duplicate canonical boards as a conflict for a %s",
    async (role) => {
      const local = new LocalBoardsRepo();
      local.createBoard(owner(), { name: "A", source: NEWCUST_BOARD_SOURCE });
      local.createBoard(owner(), { name: "B", source: NEWCUST_BOARD_SOURCE });
      const counted = countedRepo(toAsyncBoardsRepo(local));
      const request = client(counted.repo);

      await expect(repairNewcustBoardOnEntry(
        { ...owner(), role, scope: role === "member" ? "assigned" : "all" },
        request as never,
      )).resolves.toEqual({ kind: "conflict" });
      expect(counted.reads.listBoards).toHaveBeenCalledTimes(1);
      expect(loadMemberOrgSummaryWithClient).not.toHaveBeenCalled();
      expect(request.rpc).not.toHaveBeenCalled();
    },
  );

  it("reuses the resolved board and starts owner board/member reads concurrently", async () => {
    const local = new LocalBoardsRepo();
    const baseRepo = toAsyncBoardsRepo(local);
    const assignees = [{ userId: SEED_USER_OWNER, displayName: "Owner" }];
    const { boardId } = await ensureDefaultTab(owner(), NEW_LEAD_TAB, baseRepo, assignees);
    const counted = countedRepo(baseRepo);
    const originalListBoards = counted.reads.listBoards.getMockImplementation()!;
    let releaseBoards!: () => void;
    let releaseSummary!: () => void;
    let boardsStarted = false;
    let summaryStarted = false;
    const boardsGate = new Promise<void>((resolve) => { releaseBoards = resolve; });
    const summaryGate = new Promise<void>((resolve) => { releaseSummary = resolve; });
    counted.reads.listBoards.mockImplementationOnce(async (...args) => {
      boardsStarted = true;
      await boardsGate;
      return originalListBoards(...args);
    });
    loadMemberOrgSummaryWithClient.mockImplementationOnce(async () => {
      summaryStarted = true;
      await summaryGate;
      return {
        kind: "ready",
        owner: { userId: SEED_USER_OWNER, displayName: "Owner" },
        admins: [],
        members: [],
      };
    });

    const pending = repairNewcustBoardOnEntry(owner(), client(counted.repo) as never);
    await vi.waitFor(() => expect({ boardsStarted, summaryStarted }).toEqual({ boardsStarted: true, summaryStarted: true }));
    releaseBoards();
    releaseSummary();

    await expect(pending).resolves.toEqual({ kind: "ready", boardId });
    expect(counted.reads.listBoards).toHaveBeenCalledTimes(1);
    expect(counted.reads.listGroups).toHaveBeenCalledTimes(1);
    expect(counted.reads.listColumns).toHaveBeenCalledTimes(1);
    expect(counted.reads.getDefaultDefinitionState).toHaveBeenCalledTimes(1);
  });

  it("repairs the exact org for owner/admin and includes the BBE-173 industry column", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const request = client(repo);
    const result = await repairNewcustBoardOnEntry(owner(), request as never);
    expect(result.kind).toBe("ready");
    const boardId = result.kind === "ready" ? result.boardId : "";
    expect(local.listBoards(owner()).filter((board) => board.source === NEWCUST_BOARD_SOURCE)).toHaveLength(1);
    expect(local.listColumns(owner(), boardId).some((column) => column.key === "industry")).toBe(true);
    expect(request.rpc.mock.calls.map(([name]) => name)).toEqual([
      "acquire_default_tab_repair_lease",
      "renew_default_tab_repair_lease",
      "renew_default_tab_repair_lease",
      "release_default_tab_repair_lease",
    ]);
  });

  it("fails closed when multiple canonical candidates are observed", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(owner(), { name: "A", source: NEWCUST_BOARD_SOURCE });
    local.createBoard(owner(), { name: "B", source: NEWCUST_BOARD_SOURCE });
    const result = await repairNewcustBoardOnEntry(owner(), client(toAsyncBoardsRepo(local)) as never);
    expect(result).toEqual({ kind: "conflict" });
    expect(local.listBoards(owner())).toHaveLength(2);
  });

  it("keeps canonical conflict precedence when the concurrent member read fails", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(owner(), { name: "A", source: NEWCUST_BOARD_SOURCE });
    local.createBoard(owner(), { name: "B", source: NEWCUST_BOARD_SOURCE });
    loadMemberOrgSummaryWithClient.mockRejectedValueOnce(new Error("member summary unavailable"));
    const request = client(toAsyncBoardsRepo(local));

    await expect(repairNewcustBoardOnEntry(owner(), request as never)).resolves.toEqual({ kind: "conflict" });
    expect(request.rpc).not.toHaveBeenCalled();
  });

  it("fails closed before drift or repair when the member summary rejects", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(owner(), { name: "신규리드", source: NEWCUST_BOARD_SOURCE });
    loadMemberOrgSummaryWithClient.mockRejectedValueOnce(new Error("member summary unavailable"));
    const counted = countedRepo(toAsyncBoardsRepo(local));
    const request = client(counted.repo);

    await expect(repairNewcustBoardOnEntry(owner(), request as never)).rejects.toThrow("member summary unavailable");
    expect(counted.reads.listGroups).not.toHaveBeenCalled();
    expect(counted.reads.listColumns).not.toHaveBeenCalled();
    expect(request.rpc).not.toHaveBeenCalled();
  });

  it("serializes concurrent entry repair and converges on one complete board", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const request = client(repo);
    const [first, second] = await Promise.all([
      repairNewcustBoardOnEntry(owner(), request as never),
      repairNewcustBoardOnEntry(owner(), request as never),
    ]);
    expect(first).toEqual(second);
    const board = local.listBoards(owner()).find((candidate) => candidate.source === NEWCUST_BOARD_SOURCE)!;
    expect(local.listGroups(owner(), board.id)).toHaveLength(NEW_LEAD_TAB.groups.length);
    expect(local.listColumns(owner(), board.id)).toHaveLength(NEW_LEAD_TAB.columns.length);
  });
});
