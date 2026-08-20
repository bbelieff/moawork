import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BBE-239 · 공지사항 한정 「작성자는 자기 글 삭제 가능」 예외.
 *
 * `work.item_delete` 는 역할 기반뿐(owner/admin only) — 작성자 예외는 `deleteItemAction`
 * 이 공지사항 보드(source=core.default-tab/notice)에서만 추가로 검사한다. 다른 보드는
 * 그대로 역할 권한만 본다.
 */

const { loadPermGuard, getBoardDetail, getItem, deleteItem } = vi.hoisted(() => ({
  loadPermGuard: vi.fn(),
  getBoardDetail: vi.fn(),
  getItem: vi.fn(),
  deleteItem: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({
    org: { id: "org-1", name: "회사" },
    user: { id: "author-1", name: "작성자", email: "author@example.test" },
    role: "member",
    scope: "all",
  }),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: async () => ({ ok: true }) }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({ service: { getBoardDetail, getItem, deleteItem } }),
}));

import { deleteItemAction } from "./actions";
import { NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import { NOTICE_KEYS } from "@/lib/notices/types";

function deleteForm(boardId: string, itemId: string): FormData {
  const form = new FormData();
  form.set("boardId", boardId);
  form.set("itemId", itemId);
  return form;
}

describe("BBE-239 · deleteItemAction 공지사항 작성자 삭제 예외", () => {
  beforeEach(() => {
    loadPermGuard.mockReset();
    getBoardDetail.mockReset();
    getItem.mockReset();
    deleteItem.mockClear();
  });

  it("role 삭제 권한이 없어도 작성자 본인은 자기 공지 글을 지울 수 있다", async () => {
    loadPermGuard.mockResolvedValue({ kind: "denied", reason: "permission" });
    getBoardDetail.mockResolvedValue({ board: { id: "board-1", source: NOTICE_TAB_SOURCE }, columns: [], groups: [] });
    getItem.mockResolvedValue({ id: "item-1", values: { [NOTICE_KEYS.author]: "author-1" } });

    await deleteItemAction(deleteForm("board-1", "item-1"));

    expect(deleteItem).toHaveBeenCalledWith(expect.anything(), "board-1", "item-1");
  });

  it("작성자가 아닌 사람은 role 권한 없이 남의 공지 글을 못 지운다", async () => {
    loadPermGuard.mockResolvedValue({ kind: "denied", reason: "permission" });
    getBoardDetail.mockResolvedValue({ board: { id: "board-1", source: NOTICE_TAB_SOURCE }, columns: [], groups: [] });
    getItem.mockResolvedValue({ id: "item-1", values: { [NOTICE_KEYS.author]: "someone-else" } });

    await deleteItemAction(deleteForm("board-1", "item-1"));

    expect(deleteItem).not.toHaveBeenCalled();
  });

  it("owner/admin(role 권한 있음)은 작성자가 아니어도 공지 글을 지울 수 있다", async () => {
    loadPermGuard.mockResolvedValue({ kind: "allowed" });
    getBoardDetail.mockResolvedValue({ board: { id: "board-1", source: NOTICE_TAB_SOURCE }, columns: [], groups: [] });
    getItem.mockResolvedValue({ id: "item-1", values: { [NOTICE_KEYS.author]: "someone-else" } });

    await deleteItemAction(deleteForm("board-1", "item-1"));

    expect(deleteItem).toHaveBeenCalledWith(expect.anything(), "board-1", "item-1");
  });

  it("이 예외는 공지사항이 아닌 다른 보드에는 적용되지 않는다", async () => {
    loadPermGuard.mockResolvedValue({ kind: "denied", reason: "permission" });
    getBoardDetail.mockResolvedValue({
      board: { id: "board-2", source: "core.default-tab/contract-work" },
      columns: [],
      groups: [],
    });
    getItem.mockResolvedValue({ id: "item-2", values: { [NOTICE_KEYS.author]: "author-1" } });

    await deleteItemAction(deleteForm("board-2", "item-2"));

    expect(deleteItem).not.toHaveBeenCalled();
  });
});
