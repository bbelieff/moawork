import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  risky: vi.fn(),
  deleteBoard: vi.fn(),
  order: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const cookieSet = vi.fn();
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: cookieSet })) }));

/** 이번 호출에서 사용자에게 «보여줄» 사유가 실제로 남았는지. */
function flashedMessage(): string {
  const call = [...cookieSet.mock.calls].reverse().find(([name]) => name === "mw_board_err");
  return call ? decodeURIComponent(String(call[1])) : "";
}
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, role: "owner" })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: mocks.risky }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    service: {
      deleteBoard: (...args: unknown[]) => {
        mocks.order.push("delete");
        return mocks.deleteBoard(...args);
      },
    },
  }),
}));

import { deleteBoardAction } from "./actions";

function input(): FormData {
  const form = new FormData();
  form.set("boardId", "board-a");
  return form;
}

describe("board action permission boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.guard.mockImplementation(async () => {
      mocks.order.push("guard");
      return { kind: "allowed" };
    });
    mocks.risky.mockImplementation(async () => {
      mocks.order.push("audit");
      return { ok: true };
    });
  });

  it("does not call the board store when permission is denied", async () => {
    mocks.guard.mockResolvedValue({ kind: "denied", reason: "permission" });
    // BBE-213: 던지지 않는다(전면 오류 금지). 대신 화면에 사유가 남고, 저장소는 안 불린다.
    await expect(deleteBoardAction(input())).resolves.toBeUndefined();
    expect(flashedMessage()).toContain("권한이 없어요");
    expect(mocks.deleteBoard).not.toHaveBeenCalled();
  });

  it("does not delete when the mandatory risk audit fails", async () => {
    mocks.risky.mockResolvedValue({ ok: false });
    await expect(deleteBoardAction(input())).resolves.toBeUndefined();
    expect(flashedMessage()).toContain("기록을 남기지 못해");
    expect(mocks.deleteBoard).not.toHaveBeenCalled();
  });

  it("deletes only after permission and risk audit succeed", async () => {
    await deleteBoardAction(input());
    expect(mocks.guard).toHaveBeenCalledWith("org-a", "danger.bulk_edit_delete");
    expect(mocks.risky).toHaveBeenCalledWith("org-a", "danger.bulk_edit_delete", { operation: "danger.bulk_edit_delete" });
    expect(mocks.order).toEqual(["guard", "audit", "delete"]);
  });

  // ★ 되돌리면 빨개진다: runBoardAction 의 «성공하면 지운다» 한 줄을 지우기
  //
  //   #258 에서 DC-15 가 잡아 준 성질인데, 래퍼로 올리면서 addItemAction 에만 남아
  //   19개 중 1개만 지우고 있었다. MAX_AGE 10초라 «실패 → 고침 → 성공» 이 그 안에 들어가면
  //   성공한 뒤에도 방금 전 배너가 다시 그려진다 — 판정은 성공인데 화면은 실패다.
  it("성공하면 «이전 실패» 를 지운다 — 고친 뒤 옛 배너가 다시 그려지지 않는다", async () => {
    mocks.guard.mockResolvedValue({ kind: "denied", reason: "permission" });
    await deleteBoardAction(input());
    expect(flashedMessage()).toContain("권한이 없어요"); // 실패는 남아야 한다

    cookieSet.mockClear();
    mocks.guard.mockResolvedValue({ kind: "allowed" });
    mocks.risky.mockResolvedValue({ ok: true });
    mocks.deleteBoard.mockResolvedValue(undefined);
    await deleteBoardAction(input());

    // 성공 뒤 마지막으로 쓰인 값이 «빈 값(삭제)» 여야 한다.
    const last = [...cookieSet.mock.calls].reverse().find(([name]) => name === "mw_board_err");
    expect(last, "성공 경로가 쿠키를 건드리지 않았다").toBeDefined();
    expect(String(last?.[1] ?? "")).toBe("");
  });
});
