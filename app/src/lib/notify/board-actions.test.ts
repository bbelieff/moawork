import { describe, expect, it, vi } from "vitest";
import { notifyBoardItemMoved } from "./board-actions";

const ctx = {
  org: { id: "org-1" },
  user: { id: "member-1" },
} as never;

describe("notifyBoardItemMoved", () => {
  it("passes tenant, target, and stable event identity to the request-scoped RPC", async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));
    const count = await notifyBoardItemMoved({ rpc } as never, ctx, {
      boardId: "board-1",
      itemId: "item-1",
      eventKey: "00000000-0000-4000-8000-000000000099",
    });
    expect(count).toBe(1);
    expect(rpc).toHaveBeenCalledWith("notify_board_item_moved", {
      p_org_id: "org-1",
      p_board_id: "board-1",
      p_item_id: "item-1",
      p_event_key: "00000000-0000-4000-8000-000000000099",
    });
  });

  it("does not hide provider/RPC failures as a successful notification", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "denied" } }));
    await expect(notifyBoardItemMoved({ rpc } as never, ctx, {
      boardId: "board-1",
      itemId: "item-1",
      eventKey: "00000000-0000-4000-8000-000000000099",
    })).rejects.toThrow("denied");
  });
});
