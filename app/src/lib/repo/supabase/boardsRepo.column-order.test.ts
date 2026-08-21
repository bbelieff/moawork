import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { SupabaseBoardsRepo } from "./boardsRepo";

const ctx = { org: { id: "org-a" }, user: { id: "user-a" }, role: "owner", scope: "all" } as Ctx;

describe("BBE-263 SupabaseBoardsRepo column ordering", () => {
  it("uses the request caller's durable position instead of a memoized row count", async () => {
    let inserted: Record<string, unknown> | undefined;
    let writing = false;
    const builder = new Proxy({} as Record<string, unknown>, {
      get(_target, property) {
        if (property === "then") {
          const data = writing
            ? { id: "column-a", org_id: "org-a", board_id: "board-a", ...inserted }
            : [];
          return (resolve: (value: { data: unknown; error: null }) => unknown) => resolve({ data, error: null });
        }
        return (...args: unknown[]) => {
          if (property === "insert") {
            writing = true;
            inserted = args[0] as Record<string, unknown>;
          }
          return builder;
        };
      },
    });
    const client = { from: vi.fn(() => builder) };

    const column = await new SupabaseBoardsRepo(client as never).createColumn(ctx, "board-a", {
      key: "memo",
      label: "메모",
      type: "text",
      sortOrder: 9,
    });

    expect(inserted).toMatchObject({ org_id: "org-a", board_id: "board-a", sort_order: 9 });
    expect(column.sort_order).toBe(9);
  });
});
