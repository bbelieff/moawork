import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { getBoardColumnOrder, setGroupColumnOrder } from "@/app/(app)/boards/groupLayout";
import { GROUP_LAYOUT_MARKER, GROUP_LAYOUT_VIEW_NAME } from "@/lib/boards/group-layout-store";
import { SupabaseBoardsRepo } from "./boardsRepo";

const ctx = {
  org: { id: "org-a" },
  user: { id: "user-a" },
  role: "owner",
  scope: "all",
} as Ctx;

function persistentClient() {
  let visibleColumns: unknown[] | null = null;
  const rpc = vi.fn(async (_name: string, args: { p_group_key: string; p_column_keys: string[] }) => {
    const order = visibleColumns?.[0] && typeof visibleColumns[0] === "object"
      ? { ...(visibleColumns[0] as Record<string, string[]>) }
      : {};
    if (args.p_column_keys.length === 0) delete order[args.p_group_key];
    else order[args.p_group_key] = [...args.p_column_keys];
    visibleColumns = Object.keys(order).length > 0 ? [order] : null;
    return { data: null, error: null };
  });
  const from = vi.fn(() => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data: visibleColumns ? {
          name: GROUP_LAYOUT_VIEW_NAME,
          filters_jsonb: { system: GROUP_LAYOUT_MARKER },
          visible_columns_jsonb: visibleColumns,
        } : null,
        error: null,
      }),
    };
    return query;
  });
  return { client: { from, rpc }, rpc };
}

describe("BBE-195 SupabaseBoardsRepo group layout", () => {
  it("새 앱 저장소 인스턴스도 DB에 저장된 변경과 기본복구를 그대로 읽는다", async () => {
    const persistent = persistentClient();
    const beforeRestart = new SupabaseBoardsRepo(persistent.client as never);
    await setGroupColumnOrder(beforeRestart, ctx, "board-a", "group-a", ["owner", "status"]);

    (globalThis as { __moaworkGroupLayout?: Map<string, string[]> }).__moaworkGroupLayout = new Map();
    const afterRestart = new SupabaseBoardsRepo(persistent.client as never);
    await expect(getBoardColumnOrder(afterRestart, ctx, "board-a")).resolves.toEqual({
      "group-a": ["owner", "status"],
    });

    await setGroupColumnOrder(afterRestart, ctx, "board-a", "group-a", []);
    await expect(getBoardColumnOrder(new SupabaseBoardsRepo(persistent.client as never), ctx, "board-a"))
      .resolves.toEqual({});
    expect(persistent.rpc).toHaveBeenCalledTimes(2);
  });
});
