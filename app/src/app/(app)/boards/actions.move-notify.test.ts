import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  client,
  setCells,
  updateItem,
  listItems,
  moveRowAtomic,
  notifyBoardItemMoved,
} = vi.hoisted(() => ({
  client: { rpc: vi.fn() },
  setCells: vi.fn(async (): Promise<{ errors: unknown[]; notices?: unknown[] }> => ({ errors: [] })),
  updateItem: vi.fn(async () => undefined),
  listItems: vi.fn(async () => [
    { id: "item-1", group_id: "group-a", sort_order: 0 },
    { id: "item-2", group_id: "group-b", sort_order: 0 },
  ]),
  moveRowAtomic: vi.fn(async () => ({itemId:"item-1",targetGroupId:"group-b",beforeItemId:null,version:1,replayed:false})),
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
    service: {
      setCells,
      updateItem,
      listItems,
      moveRowAtomic,
      getBoardDetail: async () => ({ columns: [{ key: "status", type: "status" }] }),
    },
  }),
}));
vi.mock("@/lib/notify/board-actions", () => ({ notifyBoardItemMoved }));

import { moveItemAction, moveRowAction, setCellAction } from "./actions";
import { ROW_MOVE_VALUE_ONLY_NOTICE } from "@/lib/boards/boardActionFlash";

/** 저장은 됐지만 옮길 그룹이 없어 행은 그대로 둔 결과(#845 검토 P3) — 실패가 아니다. */
const VALUE_ONLY_SAVE = {
  errors: [],
  notices: [{ key: "status", label: "상태", message: ROW_MOVE_VALUE_ONLY_NOTICE }],
};

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
    moveRowAtomic.mockClear();
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
      "00000000-0000-4000-8000-000000000099",
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
      beforeItemId: "",
      expectedVersion: "0",
      requestId: "00000000-0000-4000-8000-000000000100",
      eventKey: "00000000-0000-4000-8000-000000000100",
    }));

    expect(moveRowAtomic).toHaveBeenCalledTimes(1);
    expect(notifyBoardItemMoved).toHaveBeenCalledTimes(1);
    expect(moveRowAtomic.mock.invocationCallOrder[0]).toBeLessThan(
      notifyBoardItemMoved.mock.invocationCallOrder[0],
    );
  });

  it("treats a value-only save notice as success on kanban value moves (ok + notice, still notifies)", async () => {
    setCells.mockImplementationOnce(async () => VALUE_ONLY_SAVE);

    const result = await moveItemAction(form({
      boardId: "board-1",
      itemId: "item-1",
      groupBy: "status",
      lane: "opt-doing",
      eventKey: "00000000-0000-4000-8000-000000000102",
    }));

    expect(result).toEqual({ ok: true, version: null, replayed: false, notice: ROW_MOVE_VALUE_ONLY_NOTICE });
    expect(notifyBoardItemMoved).toHaveBeenCalledTimes(1);
  });

  it("still sends the status notification when a status cell save only carries a notice", async () => {
    setCells.mockImplementationOnce(async () => VALUE_ONLY_SAVE);

    await setCellAction(form({ boardId: "board-1", itemId: "item-1", columnKey: "status", kind: "status", value: "opt-doing" }));

    expect(setCells).toHaveBeenCalledTimes(1);
    expect(notifyBoardItemMoved).toHaveBeenCalledTimes(1);
  });

  it("uses the same atomic primitive for physical kanban group moves",async()=>{
    await moveItemAction(form({boardId:"board-1",itemId:"item-1",groupBy:"",lane:"group-b",expectedVersion:"0",eventKey:"00000000-0000-4000-8000-000000000101"}));
    expect(moveRowAtomic).toHaveBeenCalledWith(expect.anything(),"board-1",{
      itemId:"item-1",targetGroupId:"group-b",beforeItemId:null,expectedVersion:0,requestId:"00000000-0000-4000-8000-000000000101",
    });
    expect(updateItem).not.toHaveBeenCalled();
  });
});
