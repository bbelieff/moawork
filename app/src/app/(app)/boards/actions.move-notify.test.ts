import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  client,
  setCells,
  updateItem,
  listItems,
  notifyBoardItemMoved,
} = vi.hoisted(() => ({
  client: { rpc: vi.fn() },
  setCells: vi.fn(async () => ({ errors: [] })),
  updateItem: vi.fn(async () => undefined),
  listItems: vi.fn(async () => [
    { id: "item-1", group_id: "group-a", sort_order: 0 },
    { id: "item-2", group_id: "group-b", sort_order: 0 },
  ]),
  notifyBoardItemMoved: vi.fn(async () => 1),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({
    org: { id: "org-1", name: "회사" },
    user: { id: "member-1", name: "멤버", email: "member@example.test" },
    role: "member",
    scope: "all",
  }),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: async () => ({ kind: "allowed" }) }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: async () => ({ ok: true }) }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    client,
    service: { setCells, updateItem, listItems },
  }),
}));
vi.mock("@/lib/notify/board-actions", () => ({ notifyBoardItemMoved }));

import { moveItemAction, moveRowAction } from "./actions";

function form(entries: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(entries)) result.set(key, value);
  return result;
}

describe("board move notification producer", () => {
  beforeEach(() => {
    setCells.mockClear();
    updateItem.mockClear();
    listItems.mockClear();
    notifyBoardItemMoved.mockClear();
  });

  it("emits the stable event after a kanban value move", async () => {
    await moveItemAction(form({
      boardId: "board-1",
      itemId: "item-1",
      groupBy: "status",
      lane: "opt-doing",
      eventKey: "00000000-0000-4000-8000-000000000099",
    }));

    expect(setCells).toHaveBeenCalledWith(
      expect.objectContaining({ org: expect.objectContaining({ id: "org-1" }) }),
      "board-1",
      "item-1",
      { status: "opt-doing" },
    );
    expect(notifyBoardItemMoved).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ user: expect.objectContaining({ id: "member-1" }) }),
      {
        boardId: "board-1",
        itemId: "item-1",
        eventKey: "00000000-0000-4000-8000-000000000099",
      },
    );
    expect(setCells.mock.invocationCallOrder[0]).toBeLessThan(
      notifyBoardItemMoved.mock.invocationCallOrder[0],
    );
  });

  it("emits once after the row reorder writes complete", async () => {
    await moveRowAction(form({
      boardId: "board-1",
      itemId: "item-1",
      groupId: "group-b",
      index: "1",
      eventKey: "00000000-0000-4000-8000-000000000100",
    }));

    expect(listItems).toHaveBeenCalledTimes(1);
    expect(updateItem).toHaveBeenCalledTimes(2);
    expect(notifyBoardItemMoved).toHaveBeenCalledTimes(1);
    expect(Math.max(...updateItem.mock.invocationCallOrder)).toBeLessThan(
      notifyBoardItemMoved.mock.invocationCallOrder[0],
    );
  });
});
