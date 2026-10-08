import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { ITEMS_WITH_VALUES_SELECT, SupabaseBoardsRepo } from "./boardsRepo";

const ctx = {
  org: { id: "org-a" },
  user: { id: "user-a" },
  role: "owner",
  scope: "all",
} as Ctx;

function clientReturning(data: unknown) {
  const calls: Array<[string, ...unknown[]]> = [];
  const result = { data, error: null };
  const builder = new Proxy({} as Record<string, unknown>, {
    get(_target, property) {
      if (property === "then") return (resolve: (value: typeof result) => unknown) => resolve(result);
      return (...args: unknown[]) => {
        calls.push([String(property), ...args]);
        return builder;
      };
    },
  });
  return { calls, client: { from: vi.fn(() => builder) } };
}

describe("Issue 857 · 행과 값을 한 왕복으로 읽기", () => {
  it("외래키 이름을 붙여 묶는다 — 이름 없는 item_values(*) 는 운영에서 PGRST201(관계 모호)", async () => {
    expect(ITEMS_WITH_VALUES_SELECT).toBe("*, item_values!item_values_org_item_fkey(*)");
    const read = clientReturning([]);
    await new SupabaseBoardsRepo(read.client as never).listItemsWithValues(ctx, "board-a", "active");
    expect(read.client.from).toHaveBeenCalledWith("items");
    expect(read.calls).toContainEqual(["select", ITEMS_WITH_VALUES_SELECT]);
    expect(read.calls).toContainEqual(["eq", "org_id", "org-a"]);
    expect(read.calls).toContainEqual(["eq", "board_id", "board-a"]);
    expect(read.calls).toContainEqual(["is", "deleted_at", null]);
    expect(read.calls).toContainEqual(["is", "archived_at", null]);
  });

  it("묶여 온 값을 행에서 떼어 내고, 다른 회사 값은 버린다", async () => {
    const read = clientReturning([
      {
        id: "item-1",
        board_id: "board-a",
        item_values: [
          { org_id: "org-a", item_id: "item-1", column_key: "status", value_jsonb: "진행" },
          { org_id: "org-b", item_id: "item-1", column_key: "memo", value_jsonb: "남의 값" },
        ],
      },
      { id: "item-2", board_id: "board-a", item_values: null },
    ]);
    const { items, values } = await new SupabaseBoardsRepo(read.client as never).listItemsWithValues(ctx, "board-a", "deleted");
    expect(items).toEqual([{ id: "item-1", board_id: "board-a" }, { id: "item-2", board_id: "board-a" }]);
    expect(values).toEqual([{ org_id: "org-a", item_id: "item-1", column_key: "status", value_jsonb: "진행" }]);
    expect(read.calls).toContainEqual(["not", "deleted_at", "is", null]);
  });
});
