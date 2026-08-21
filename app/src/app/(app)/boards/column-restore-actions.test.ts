import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" } })),
  loadPermGuard: vi.fn(async () => ({ kind: "allowed" })),
  restoreColumn: vi.fn(async () => ({})),
  revalidatePath: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: mocks.cookieSet })) }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.loadPermGuard }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: vi.fn(async () => ({ service: { restoreColumn: mocks.restoreColumn } })) }));

import { restoreColumnAction } from "./column-restore-actions";

function form() {
  const data = new FormData();
  data.set("boardId", "board-a");
  data.set("columnId", "column-a");
  return data;
}

describe("BBE-221 컬럼 원본 복구 액션", () => {
  beforeEach(() => vi.clearAllMocks());

  it("구조 권한과 board/column 범위를 서비스에 전달하고 화면을 갱신한다", async () => {
    await restoreColumnAction("board-a", form());
    expect(mocks.loadPermGuard).toHaveBeenCalledWith("org-a", "structure.column_manage");
    expect(mocks.restoreColumn).toHaveBeenCalledWith(expect.anything(), "board-a", "column-a");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/boards/board-a");
  });

  it("권한이 없으면 복구 mutation을 호출하지 않는다", async () => {
    mocks.loadPermGuard.mockResolvedValueOnce({ kind: "denied", reason: "permission" } as never);
    await expect(restoreColumnAction("board-a", form())).resolves.toBeUndefined();
    expect(mocks.restoreColumn).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenLastCalledWith(
      "mw_board_err",
      expect.stringContaining("%EA%B6%8C%ED%95%9C"),
      expect.objectContaining({ maxAge: 10 }),
    );
  });

  it("권한 확인 불가와 저장소 실패를 화면 배너로 바꾸고 mutation 실패를 삼킨다", async () => {
    mocks.loadPermGuard.mockResolvedValueOnce({ kind: "denied", reason: "unavailable" } as never);
    await restoreColumnAction("board-a", form());
    expect(mocks.restoreColumn).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenLastCalledWith("mw_board_err", expect.any(String), expect.objectContaining({ maxAge: 10 }));

    mocks.restoreColumn.mockRejectedValueOnce(new Error("private database detail"));
    await expect(restoreColumnAction("board-a", form())).resolves.toBeUndefined();
    expect(mocks.revalidatePath).toHaveBeenLastCalledWith("/boards/board-a");
    expect(mocks.cookieSet).toHaveBeenLastCalledWith("mw_board_err", expect.not.stringContaining("private"), expect.objectContaining({ maxAge: 10 }));
  });

  it("렌더 시점에 고정된 board 범위가 없으면 오류 경계나 mutation으로 보내지 않는다", async () => {
    const malformed = new FormData();
    await expect(restoreColumnAction("", malformed)).resolves.toBeUndefined();
    expect(mocks.restoreColumn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
