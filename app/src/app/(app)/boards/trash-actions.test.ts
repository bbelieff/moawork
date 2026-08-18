import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({
    user: { id: "user-a" },
    org: { id: "org-a" },
    role: "owner",
    scope: "all",
  })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: vi.fn(async () => ({
    service: {
      deleteItem: mocks.trash,
      restoreItem: mocks.restore,
    },
  })),
}));

import {
  restoreItemAction,
  trashItemAction,
} from "./trash-actions";
import { INITIAL_TRASH_ACTION_STATE } from "./trash-action-state";

function input(): FormData {
  const form = new FormData();
  form.set("boardId", "board-a");
  form.set("itemId", "item-a");
  return form;
}

describe("BBE-168 trash server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ kind: "allowed" });
  });

  it("uses the request-bound service and refreshes the board after trash", async () => {
    await expect(trashItemAction(INITIAL_TRASH_ACTION_STATE, input())).resolves.toEqual({
      ok: true,
      message: "항목을 휴지통으로 옮겼습니다.",
    });
    expect(mocks.guard).toHaveBeenCalledWith("org-a", "work.item_delete");
    expect(mocks.trash).toHaveBeenCalledWith(expect.objectContaining({ org: { id: "org-a" } }), "board-a", "item-a");
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-a");
  });

  it("restores through the same tenant-bound service", async () => {
    await expect(restoreItemAction(INITIAL_TRASH_ACTION_STATE, input())).resolves.toEqual({
      ok: true,
      message: "항목을 원래 위치로 복구했습니다.",
    });
    expect(mocks.restore).toHaveBeenCalledWith(expect.objectContaining({ org: { id: "org-a" } }), "board-a", "item-a");
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-a");
  });

  it("fails closed with an explicit message and no repository mutation", async () => {
    mocks.guard.mockResolvedValue({ kind: "denied", reason: "permission" });
    await expect(trashItemAction(INITIAL_TRASH_ACTION_STATE, input())).resolves.toEqual({
      ok: false,
      message: "이 항목을 삭제하거나 복구할 권한이 없습니다.",
    });
    expect(mocks.trash).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("returns persistence failures instead of making them look successful", async () => {
    mocks.restore.mockRejectedValue(new Error("복구 저장에 실패했습니다."));
    await expect(restoreItemAction(INITIAL_TRASH_ACTION_STATE, input())).resolves.toEqual({
      ok: false,
      message: "복구 저장에 실패했습니다.",
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
