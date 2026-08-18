import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BBE-177 — 컬럼 삭제 서버 액션의 «확인» 관문.
 *
 * 무엇을 깨뜨리면 이 파일이 빨개지는가:
 *  ① deleteColumnAction 에서 confirm 검사를 빼면      → 1·2번이 실패한다
 *  ② confirm 검사를 서비스 호출 «뒤» 로 옮기면          → 2번이 실패한다(이미 지운 뒤다)
 *  ③ 확인 문자열만 바꾸고 화면 hidden 값을 안 고치면    → 3번이 실패한다
 *  ④ 권한 검사를 빼거나 scope 키를 바꾸면               → 4번이 실패한다
 *
 * 화면의 details/summary 는 사용자를 멈춰 세울 뿐 관문이 아니다 — 폼을 직접 만들어
 * 보내면 그냥 지나간다. 그래서 관문은 서버에 두고, 그 사실을 여기서 고정한다.
 */

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  deleteColumn: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({
    user: { id: "user-a" },
    org: { id: "org-a" },
    role: "owner",
    scope: "all",
  })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/perm/server", () => ({
  recordRiskyAction: vi.fn(async () => ({ ok: true })),
  loadPermissionScopedWorkItems: vi.fn(),
}));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: vi.fn(async () => ({ service: { deleteColumn: mocks.deleteColumn } })),
}));

import { deleteColumnAction } from "./actions";
import { COLUMN_DELETE_CONFIRM } from "@/lib/boards/validation";

function form(confirm?: string): FormData {
  const fd = new FormData();
  fd.set("boardId", "board-a");
  fd.set("columnId", "column-a");
  if (confirm !== undefined) fd.set("confirm", confirm);
  return fd;
}

describe("BBE-177 컬럼 삭제 확인 관문", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ kind: "allowed" });
  });

  it("확인 값이 없으면 거부한다", async () => {
    await expect(deleteColumnAction(form())).rejects.toThrow("컬럼 삭제는 확인 단계를 거쳐야 합니다");
  });

  it("거부할 때는 삭제도 화면 갱신도 일어나지 않는다", async () => {
    await expect(deleteColumnAction(form("아니오"))).rejects.toThrow();
    expect(mocks.deleteColumn).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("확인을 받으면 그 보드의 컬럼만 지우고 화면을 갱신한다", async () => {
    await expect(deleteColumnAction(form(COLUMN_DELETE_CONFIRM))).resolves.toBeUndefined();
    expect(mocks.deleteColumn).toHaveBeenCalledWith(
      expect.objectContaining({ org: { id: "org-a" } }),
      "board-a",
      "column-a",
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-a");
  });

  it("권한이 없으면 확인을 받았어도 지우지 않는다", async () => {
    mocks.guard.mockResolvedValue({ kind: "denied", reason: "permission" });

    // ★ «던지는가» 가 아니라 «지우는가» 를 잰다.
    //   BBE-213(#263)이 보드 액션 실패를 배너로 바꿨다(runBoardAction 이 잡고 다시 안 던진다).
    //   그래서 권한 거부는 더 이상 호출자에게 throw 로 오지 않는다 — «경로» 가 바뀐 것이지
    //   «막는가» 가 바뀐 것이 아니다. 이 테스트가 지키는 성질은 뒤의 두 줄이고 그건 그대로다.
    //   되돌리면 빨개진다: requirePermission 을 지우거나 deleteColumn 뒤로 옮기기.
    await expect(deleteColumnAction(form(COLUMN_DELETE_CONFIRM))).resolves.toBeUndefined();
    expect(mocks.guard).toHaveBeenCalledWith("org-a", "structure.column_manage");
    expect(mocks.deleteColumn).not.toHaveBeenCalled();
  });
});
