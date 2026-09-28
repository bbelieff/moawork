import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { db, resetDb } from "@/lib/repo/local/store";
import { CONTACT_TAB } from "./contact";
import { DEFAULT_TABS, ensureDefaultTab, readDefaultTabBootstrapDrift, readDefaultTabDrift } from "./install";
import type { DefaultTab, DefaultTabAssignee } from "./types";

const ctx = {
  org: { id: "bootstrap-drift-org", name: "Test workspace" },
  user: { id: "bootstrap-owner", name: "Owner", email: "owner@example.test" },
  role: "owner", scope: "all",
} as Ctx;
const assignees: DefaultTabAssignee[] = [
  { userId: "bootstrap-owner", displayName: "Owner" },
  { userId: "bootstrap-member-a", displayName: "Member A" },
  { userId: "bootstrap-member-b", displayName: "Member B" },
];
let repo: LocalBoardsRepo;

beforeEach(() => { resetDb(); repo = new LocalBoardsRepo(); });

async function install(tab: DefaultTab = CONTACT_TAB) {
  const result = await ensureDefaultTab(ctx, tab, toAsyncBoardsRepo(repo), assignees);
  return repo.getBoard(ctx, result.boardId)!;
}

function watchWrites() {
  return [
    vi.spyOn(repo, "createBoard"), vi.spyOn(repo, "createGroup"), vi.spyOn(repo, "deleteGroup"),
    vi.spyOn(repo, "createColumn"), vi.spyOn(repo, "updateColumn"),
    vi.spyOn(repo, "reconcileDefinitionItemGroup"), vi.spyOn(repo, "setDefaultDefinitionState"),
  ];
}

describe("bootstrap drift uses the full reconciler without writes", () => {
  it.each(DEFAULT_TABS)("clean $key reads each snapshot once and never writes", async (tab) => {
    const board = await install(tab);
    const writes = watchWrites();
    const groups = vi.spyOn(repo, "listGroups");
    const columns = vi.spyOn(repo, "listColumns");
    const state = vi.spyOn(repo, "getDefaultDefinitionState");
    const boards = vi.spyOn(repo, "listBoards");
    const items = vi.spyOn(repo, "listItems");

    expect(await readDefaultTabBootstrapDrift(ctx, tab, board, toAsyncBoardsRepo(repo), assignees))
      .toEqual({ hasWork: false });
    expect(groups).toHaveBeenCalledTimes(1);
    expect(columns).toHaveBeenCalledTimes(1);
    expect(state).toHaveBeenCalledTimes(tab.revision !== undefined || tab.previousRevision !== undefined ? 1 : 0);
    expect(boards).not.toHaveBeenCalled();
    expect(items).not.toHaveBeenCalled();
    writes.forEach((write) => expect(write).not.toHaveBeenCalled());
  });

  it.each([
    ["renamed member", assignees.map((member, index) => index === 2 ? { ...member, displayName: "Renamed" } : member)],
    ["removed third member", assignees.slice(0, 2)],
    ["added third-slot member", [...assignees, { userId: "bootstrap-member-c", displayName: "Member C" }]],
  ] as const)("detects %s even when additive drift is clean", async (_description, members) => {
    const board = await install();
    const store = toAsyncBoardsRepo(repo);
    expect((await readDefaultTabDrift(ctx, CONTACT_TAB, store, members)).hasWork).toBe(false);
    const writes = watchWrites();
    expect(await readDefaultTabBootstrapDrift(ctx, CONTACT_TAB, board, store, members)).toEqual({ hasWork: true });
    writes.forEach((write) => expect(write).not.toHaveBeenCalled());

    await ensureDefaultTab(ctx, CONTACT_TAB, store, members);
    expect(await readDefaultTabBootstrapDrift(ctx, CONTACT_TAB, board, store, members)).toEqual({ hasWork: false });
  });

  it("detects retired groups before reading or moving customer rows", async () => {
    const board = await install();
    const ownerColumn = repo.listColumns(ctx, board.id).find((column) => column.key === "owner")!;
    const retiredGroupId = ownerColumn.move_rule_jsonb![assignees[1].userId];
    const row = repo.createItem(ctx, board.id, { title: "Preserved row", group_id: retiredGroupId });
    const members = assignees.slice(0, 1);
    const store = toAsyncBoardsRepo(repo);
    expect((await readDefaultTabDrift(ctx, CONTACT_TAB, store, members)).hasWork).toBe(false);
    const reads = vi.spyOn(repo, "listItems");
    const writes = watchWrites();

    expect(await readDefaultTabBootstrapDrift(ctx, CONTACT_TAB, board, store, members)).toEqual({ hasWork: true });
    expect(reads).not.toHaveBeenCalled();
    writes.forEach((write) => expect(write).not.toHaveBeenCalled());
    expect(repo.getItem(ctx, row.id)?.group_id).toBe(retiredGroupId);

    await ensureDefaultTab(ctx, CONTACT_TAB, store, members);
    expect(repo.listGroups(ctx, board.id).some((group) => group.id === retiredGroupId)).toBe(false);
    expect(repo.getItem(ctx, row.id)?.group_id).toBe(ownerColumn.move_rule_jsonb!["미배정"]);
    expect(await readDefaultTabBootstrapDrift(ctx, CONTACT_TAB, board, store, members)).toEqual({ hasWork: false });
  });

  it("detects stale assignee movement rules with all members and groups intact", async () => {
    const board = await install();
    const ownerColumn = repo.listColumns(ctx, board.id).find((column) => column.key === "owner")!;
    repo.updateColumn(ctx, ownerColumn.id, { moveRule: null });
    const writes = watchWrites();
    expect(await readDefaultTabBootstrapDrift(ctx, CONTACT_TAB, board, toAsyncBoardsRepo(repo), assignees))
      .toEqual({ hasWork: true });
    writes.forEach((write) => expect(write).not.toHaveBeenCalled());
  });

  it("missing definition state is dirty even when additive drift has no repair", async () => {
    const board = await install();
    db().boardViews = db().boardViews.filter((view) => view.board_id !== board.id || view.name !== "__mw_default_definition__");
    const store = toAsyncBoardsRepo(repo);
    expect((await readDefaultTabDrift(ctx, CONTACT_TAB, store, assignees)).hasWork).toBe(false);
    const writes = watchWrites();
    expect(await readDefaultTabBootstrapDrift(ctx, CONTACT_TAB, board, store, assignees)).toEqual({ hasWork: true });
    writes.forEach((write) => expect(write).not.toHaveBeenCalled());
  });

  it("propagates read failures so bootstrap can use the authoritative lease repair", async () => {
    const board = await install();
    vi.spyOn(repo, "listColumns").mockImplementation(() => { throw new Error("read unavailable"); });
    await expect(readDefaultTabBootstrapDrift(ctx, CONTACT_TAB, board, toAsyncBoardsRepo(repo), assignees))
      .rejects.toThrow("read unavailable");
  });
});
