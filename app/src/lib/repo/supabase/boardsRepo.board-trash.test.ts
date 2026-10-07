import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import {
  BoardTrashError,
  DefaultTabAlreadyInstalledError,
  DefaultTabDismissedError,
} from "@/lib/boards/trash-errors";
import { SupabaseBoardsRepo } from "./boardsRepo";

const ctx = {
  org: { id: "org-a" },
  user: { id: "user-a" },
  role: "owner",
  scope: "all",
} as Ctx;

type Result = { data: unknown; error: { message: string; code?: string } | null };

function fakeClient(result: Result) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = new Proxy({} as Record<string, unknown>, {
    get(_target, property) {
      if (property === "then") return (resolve: (value: Result) => unknown) => resolve(result);
      return (...args: unknown[]) => {
        calls.push([String(property), ...args]);
        return builder;
      };
    },
  });
  const rpc = vi.fn(async () => result);
  const from = vi.fn(() => builder);
  return { calls, rpc, from, repo: new SupabaseBoardsRepo({ from, rpc } as never) };
}

describe("#849 SupabaseBoardsRepo 탭 읽기", () => {
  it("보통 읽기는 휴지통 탭을 뺀다", async () => {
    for (const read of [
      (repo: SupabaseBoardsRepo) => repo.listBoards(ctx),
      (repo: SupabaseBoardsRepo) => repo.listSectionPresetBoards(ctx),
      (repo: SupabaseBoardsRepo) => repo.getBoard(ctx, "board-a"),
    ]) {
      const fake = fakeClient({ data: [], error: null });
      await read(fake.repo);
      expect(fake.calls).toContainEqual(["eq", "org_id", "org-a"]);
      expect(fake.calls).toContainEqual(["is", "deleted_at", null]);
    }
  });

  it("휴지통 목록은 지운 순서대로, 섹션 프리셋 틀은 뺀다", async () => {
    const fake = fakeClient({
      data: [
        { id: "board-a", trashed_source: null },
        { id: "preset", trashed_source: "user.section-preset/x" },
      ],
      error: null,
    });
    const boards = await fake.repo.listTrashedBoards(ctx);
    expect(boards.map((board) => board.id)).toEqual(["board-a"]);
    expect(fake.calls).toContainEqual(["not", "deleted_at", "is", null]);
    expect(fake.calls).toContainEqual(["order", "deleted_at", { ascending: false }]);
  });

  it("지운 기본 탭 기록은 이 회사 것만 읽는다", async () => {
    const fake = fakeClient({ data: [{ org_id: "org-a", source: "core.default-tab/x", dismissed_at: "t", dismissed_by: null }], error: null });
    await expect(fake.repo.listDefaultTabDismissals(ctx)).resolves.toHaveLength(1);
    expect(fake.from).toHaveBeenCalledWith("default_tab_dismissals");
    expect(fake.calls).toContainEqual(["eq", "org_id", "org-a"]);
  });
});

describe("#849 SupabaseBoardsRepo 탭 만들기·휴지통 RPC", () => {
  it("만들기에 사이드바 자리를 넘기고, 지운 기본 탭은 종류가 있는 오류로 바꾼다", async () => {
    const ok = fakeClient({ data: { id: "board-a", nav_section: "before-contract" }, error: null });
    await ok.repo.createBoard(ctx, { name: "상담", nav_section: "before-contract" }, "req-1");
    expect(ok.rpc).toHaveBeenCalledWith("create_workspace_board", expect.objectContaining({
      p_org_id: "org-a", p_name: "상담", p_source: null, p_request_id: "req-1", p_nav_section: "before-contract",
    }));

    const dismissed = fakeClient({ data: null, error: { message: "default_tab_dismissed", code: "55000" } });
    await expect(dismissed.repo.createBoard(ctx, { name: "기본", source: "core.default-tab/x" })).rejects.toBeInstanceOf(DefaultTabDismissedError);

    // 다른 오류는 지금처럼 원문 그대로 둔다.
    const replay = fakeClient({ data: null, error: { message: "request_replay_conflict", code: "23505" } });
    await expect(replay.repo.createBoard(ctx, { name: "x" })).rejects.toThrow("request_replay_conflict");
  });

  it("자리를 안 고른 만들기(기본 탭·프리셋)는 p_nav_section 을 보내지 않는다", async () => {
    const fake = fakeClient({ data: { id: "board-a" }, error: null });
    await fake.repo.createBoard(ctx, { name: "기본", source: "core.default-tab/x" }, "req-2");
    const args = (fake.rpc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(args).toMatchObject({ p_org_id: "org-a", p_source: "core.default-tab/x", p_request_id: "req-2" });
    expect(args).not.toHaveProperty("p_nav_section");
  });

  it("순서 저장 결과에서 휴지통 탭은 뺀다", async () => {
    const fake = fakeClient({
      data: [{ id: "board-a", deleted_at: null }, { id: "board-trashed", deleted_at: "2026-10-07T00:00:00Z" }],
      error: null,
    });
    const boards = await fake.repo.reorderBoards(ctx, ["board-a"], "req-order");
    expect(boards.map((board) => board.id)).toEqual(["board-a"]);
    expect(fake.rpc).toHaveBeenCalledWith("reorder_workspace_boards", { p_org_id: "org-a", p_board_ids: ["board-a"], p_request_id: "req-order" });
  });

  it("휴지통·복구·완전 삭제는 org 와 탭 id 로 RPC 를 부른다", async () => {
    const row = fakeClient({ data: [{ id: "board-a", deleted_at: "2026-10-07T00:00:00Z" }], error: null });
    await expect(row.repo.trashBoard(ctx, "board-a")).resolves.toMatchObject({ id: "board-a" });
    await row.repo.restoreBoard(ctx, "board-a");
    expect(row.rpc).toHaveBeenCalledWith("trash_workspace_board", { p_org_id: "org-a", p_board_id: "board-a" });
    expect(row.rpc).toHaveBeenCalledWith("restore_workspace_board", { p_org_id: "org-a", p_board_id: "board-a" });

    const counted = fakeClient({ data: 3, error: null });
    await expect(counted.repo.purgeBoard(ctx, "board-a")).resolves.toBe(3);
    await expect(counted.repo.purgeExpiredBoards(ctx)).resolves.toBe(3);
    expect(counted.rpc).toHaveBeenCalledWith("purge_workspace_board", { p_org_id: "org-a", p_board_id: "board-a" });
    expect(counted.rpc).toHaveBeenCalledWith("purge_expired_workspace_boards", { p_org_id: "org-a" });
  });

  it("RPC 오류를 사람 말 오류로 바꾼다", async () => {
    const conflict = fakeClient({ data: null, error: { message: "default_tab_already_installed", code: "23505" } });
    await expect(conflict.repo.restoreBoard(ctx, "board-a")).rejects.toBeInstanceOf(DefaultTabAlreadyInstalledError);

    const denied = fakeClient({ data: null, error: { message: "permission_denied", code: "42501" } });
    await expect(denied.repo.trashBoard(ctx, "board-a")).rejects.toMatchObject({ code: "permission_denied" });
    await expect(denied.repo.purgeBoard(ctx, "board-a")).rejects.toBeInstanceOf(BoardTrashError);

    const notTrashed = fakeClient({ data: null, error: { message: "board_not_in_trash", code: "55000" } });
    await expect(notTrashed.repo.purgeBoard(ctx, "board-a")).rejects.toMatchObject({ code: "board_not_in_trash" });

    const unknown = fakeClient({ data: null, error: { message: "connection reset" } });
    const error = await unknown.repo.trashBoard(ctx, "board-a").catch((reason: unknown) => reason);
    expect(error).not.toBeInstanceOf(BoardTrashError);
    expect((error as Error).message).toBe("connection reset");
  });

  it("지우기 전 개수의 jsonb 숫자를 그대로 옮기고, 모르는 값은 0으로 둔다", async () => {
    const fake = fakeClient({ data: { groups: 2, rows: "5", memos: 1, files: 0, views: 3, automations: null }, error: null });
    await expect(fake.repo.readBoardTrashImpact(ctx, "board-a")).resolves.toEqual({
      groups: 2, rows: 5, memos: 1, files: 0, views: 3, automations: 0, messaging: 0,
    });
    expect(fake.rpc).toHaveBeenCalledWith("read_board_trash_impact", { p_org_id: "org-a", p_board_id: "board-a" });
  });

  it("기록 지우기·파일 정리 대기열을 RPC 로 읽고 비운다", async () => {
    const cleared = fakeClient({ data: true, error: null });
    await expect(cleared.repo.clearDefaultTabDismissal(ctx, "core.default-tab/x")).resolves.toBe(true);
    expect(cleared.rpc).toHaveBeenCalledWith("clear_default_tab_dismissal", { p_org_id: "org-a", p_source: "core.default-tab/x" });

    const queue = fakeClient({ data: ["org-a/a.pdf", "org-a/b.png"], error: null });
    await expect(queue.repo.listStoragePurgeQueue(ctx, 10)).resolves.toEqual(["org-a/a.pdf", "org-a/b.png"]);
    expect(queue.rpc).toHaveBeenCalledWith("list_board_storage_purge_queue", { p_org_id: "org-a", p_limit: 10 });

    const acked = fakeClient({ data: 2, error: null });
    await expect(acked.repo.ackStoragePurge(ctx, ["org-a/a.pdf", "org-a/b.png"])).resolves.toBe(2);
    expect(acked.rpc).toHaveBeenCalledWith("ack_board_storage_purge", { p_org_id: "org-a", p_paths: ["org-a/a.pdf", "org-a/b.png"] });
    await expect(acked.repo.ackStoragePurge(ctx, [])).resolves.toBe(0);
    expect(acked.rpc).toHaveBeenCalledTimes(1);
  });
});
