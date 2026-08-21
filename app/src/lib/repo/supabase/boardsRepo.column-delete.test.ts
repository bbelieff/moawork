import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { SupabaseBoardsRepo } from "./boardsRepo";

/**
 * BBE-177 — 운영 경로(Supabase 어댑터)에서 컬럼 삭제가 무엇을 «건드리는가» 를 고정한다.
 *
 * service.test.ts 는 로컬 인메모리 어댑터로 돈다. 그래서 supabase 쪽에 물리 삭제를
 * 되돌려 놓아도 그쪽은 초록으로 남는다 — 정작 고객 데이터가 있는 경로는 그쪽인데.
 * 이 파일이 그 구멍을 막는다.
 *
 * 무엇을 깨뜨리면 빨개지는가:
 *  ① item_values 삭제를 되돌리면            → 1번이 실패한다 (핵심)
 *  ② items 조회를 되살리면                  → 1번이 실패한다
 *  ③ org 경계나 id 조건을 흘리면            → 2번이 실패한다
 *  ④ 못 지운 것을 지웠다고 보고하면         → 3번이 실패한다
 */

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
  // 인자 타입을 명시해야 mock.calls 가 [] 가 아닌 [string] 튜플로 잡힌다.
  const from = vi.fn((table: string) => {
    void table;
    return builder;
  });
  return { calls, from, client: { from } };
}

function guardedClient(board: unknown, deleted: unknown) {
  const calls: Array<[string, string, ...unknown[]]> = [];
  const from = vi.fn((table: string) => {
    const result = { data: table === "boards" ? board : deleted, error: null };
    const builder = new Proxy({} as Record<string, unknown>, {
      get(_target, property) {
        if (property === "then") return (resolve: (value: typeof result) => unknown) => resolve(result);
        return (...args: unknown[]) => {
          calls.push([table, String(property), ...args]);
          return builder;
        };
      },
    });
    return builder;
  });
  return { calls, from, client: { from } };
}

describe("BBE-177 SupabaseBoardsRepo 컬럼 삭제", () => {
  it("board_columns 말고는 어떤 표도 건드리지 않는다", async () => {
    const c = clientReturning([{ id: "col-a" }]);
    await new SupabaseBoardsRepo(c.client as never).deleteColumn(ctx, "col-a");

    const tables = c.from.mock.calls.map(([table]) => table);
    expect(tables).toEqual(["board_columns"]);
    expect(tables).not.toContain("item_values");
    expect(tables).not.toContain("items");
    expect(c.calls.filter(([name]) => name === "delete")).toHaveLength(1);
  });

  it("삭제는 그 조직의 그 컬럼 한 건으로 좁힌다", async () => {
    const c = clientReturning([{ id: "col-a" }]);
    await new SupabaseBoardsRepo(c.client as never).deleteColumn(ctx, "col-a");

    expect(c.calls).toContainEqual(["eq", "org_id", "org-a"]);
    expect(c.calls).toContainEqual(["eq", "id", "col-a"]);
  });

  it("지운 행이 없으면 false 를 돌려준다", async () => {
    const none = clientReturning([]);
    await expect(new SupabaseBoardsRepo(none.client as never).deleteColumn(ctx, "col-a")).resolves.toBe(false);

    const one = clientReturning([{ id: "col-a" }]);
    await expect(new SupabaseBoardsRepo(one.client as never).deleteColumn(ctx, "col-a")).resolves.toBe(true);
  });

  it("org+board+column 세 조건이 맞을 때만 삭제 query를 만든다", async () => {
    const c = guardedClient({ id: "board-a", org_id: "org-a", is_system: false }, [{ id: "col-a" }]);

    await expect(new SupabaseBoardsRepo(c.client as never).deleteColumn(ctx, "board-a", "col-a")).resolves.toBe(true);

    expect(c.calls).toContainEqual(["boards", "eq", "org_id", "org-a"]);
    expect(c.calls).toContainEqual(["boards", "eq", "id", "board-a"]);
    expect(c.calls).toContainEqual(["board_columns", "eq", "org_id", "org-a"]);
    expect(c.calls).toContainEqual(["board_columns", "eq", "board_id", "board-a"]);
    expect(c.calls).toContainEqual(["board_columns", "eq", "id", "col-a"]);
  });

  it("board A에 board B의 column id를 줘서 0행이면 false이고 추가 mutation이 없다", async () => {
    const c = guardedClient({ id: "board-a", org_id: "org-a", is_system: false }, []);

    await expect(new SupabaseBoardsRepo(c.client as never).deleteColumn(ctx, "board-a", "column-b")).resolves.toBe(false);

    expect(c.from.mock.calls.map(([table]) => table)).toEqual(["boards", "board_columns"]);
    expect(c.calls.filter(([table, name]) => table === "board_columns" && name === "delete")).toHaveLength(1);
  });

  it("시스템 보드는 column delete를 발행하지 않고 false를 돌려준다", async () => {
    const c = guardedClient({ id: "board-system", org_id: "org-a", is_system: true }, [{ id: "col-a" }]);

    await expect(new SupabaseBoardsRepo(c.client as never).deleteColumn(ctx, "board-system", "col-a")).resolves.toBe(false);

    expect(c.from.mock.calls.map(([table]) => table)).toEqual(["boards"]);
    expect(c.calls.some(([table, name]) => table === "board_columns" && name === "delete")).toBe(false);
  });

  it("없는 보드는 column delete를 발행하지 않고 false를 돌려준다", async () => {
    const c = guardedClient(null, [{ id: "col-a" }]);

    await expect(new SupabaseBoardsRepo(c.client as never).deleteColumn(ctx, "board-missing", "col-a")).resolves.toBe(false);

    expect(c.from.mock.calls.map(([table]) => table)).toEqual(["boards"]);
  });
});
