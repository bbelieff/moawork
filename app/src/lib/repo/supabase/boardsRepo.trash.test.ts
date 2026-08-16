import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { SupabaseBoardsRepo } from "./boardsRepo";

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
  return {
    calls,
    client: { from: vi.fn(() => builder) },
  };
}

describe("BBE-168 SupabaseBoardsRepo trash mapping", () => {
  it("keeps active and trash reads disjoint within org and board", async () => {
    const active = clientReturning([]);
    await new SupabaseBoardsRepo(active.client as never).listItems(ctx, "board-a");
    expect(active.calls).toContainEqual(["eq", "org_id", "org-a"]);
    expect(active.calls).toContainEqual(["eq", "board_id", "board-a"]);
    expect(active.calls).toContainEqual(["is", "deleted_at", null]);

    const trash = clientReturning([]);
    await new SupabaseBoardsRepo(trash.client as never).listDeletedItems(ctx, "board-a");
    expect(trash.calls).toContainEqual(["eq", "org_id", "org-a"]);
    expect(trash.calls).toContainEqual(["eq", "board_id", "board-a"]);
    expect(trash.calls).toContainEqual(["not", "deleted_at", "is", null]);
    expect(trash.calls).toContainEqual(["order", "deleted_at", { ascending: false }]);
  });

  it("scopes trash and restore mutations to the exact board and state", async () => {
    const trashed = clientReturning([{ id: "item-a" }]);
    await expect(new SupabaseBoardsRepo(trashed.client as never).deleteItem(ctx, "board-a", "item-a")).resolves.toBe(true);
    expect(trashed.calls.find(([name]) => name === "update")?.[1]).toMatchObject({
      deleted_by: "user-a",
    });
    expect(trashed.calls).toContainEqual(["eq", "org_id", "org-a"]);
    expect(trashed.calls).toContainEqual(["eq", "board_id", "board-a"]);
    expect(trashed.calls).toContainEqual(["eq", "id", "item-a"]);
    expect(trashed.calls).toContainEqual(["is", "deleted_at", null]);

    const restored = clientReturning({ id: "item-a", board_id: "board-a" });
    await new SupabaseBoardsRepo(restored.client as never).restoreItem(ctx, "board-a", "item-a");
    expect(restored.calls.find(([name]) => name === "update")?.[1]).toMatchObject({
      deleted_at: null,
      deleted_by: null,
    });
    expect(restored.calls).toContainEqual(["eq", "board_id", "board-a"]);
    expect(restored.calls).toContainEqual(["not", "deleted_at", "is", null]);
  });
});
