import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // 시험마다 바꾸는 값은 여기 둔다 — 결과가 방금 저장한 행처럼 보인다.
  const state = {
    perm: { kind: "allowed" } as { kind: "allowed" } | { kind: "denied"; reason: string },
    memberIds: ["member-1"] as string[],
  };
  const afterCallbacks: Array<() => void | Promise<void>> = [];
  const savedRow = {
    id: "item-1",
    org_id: "org-1",
    board_id: "board-1",
    group_id: "g1",
    title: "행",
    assigned_to: null,
    deal_id: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    values: { memo: "새 값" },
  };
  const setCells = vi.fn(async () => ({ item: savedRow, errors: [], notices: [] }));
  const getBoardDetail = vi.fn(async () => ({
    columns: [
      { key: "status", type: "status" },
      { key: "owner_person", type: "person" },
      { key: "memo", type: "text" },
    ],
  }));
  const memberQuery = {
    select: vi.fn((..._args: string[]) => memberQuery),
    eq: vi.fn((..._args: string[]) => memberQuery),
    in: vi.fn(async (_column: string, ids: string[]) => ({
      data: ids.filter((id) => state.memberIds.includes(id)).map((user_id) => ({ user_id })),
      error: null,
    })),
  };
  const client = { from: vi.fn((..._args: string[]) => memberQuery) };
  const revalidatePath = vi.fn();
  const cookieSet = vi.fn();
  const notifyBoardItemMoved = vi.fn(async () => 1);
  return {
    state,
    afterCallbacks,
    savedRow,
    setCells,
    getBoardDetail,
    client,
    revalidatePath,
    cookieSet,
    notifyBoardItemMoved,
  };
});

vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({
    org: { id: "org-1" },
    user: { id: "user-1" },
    role: "owner",
    scope: "all",
  }),
}));
const permCalls: Array<[string, string]> = [];
vi.mock("@/lib/perm/guard", () => ({
  loadPermGuard: async (orgId: string, key: string) => {
    permCalls.push([orgId, key]);
    return mocks.state.perm;
  },
}));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    client: mocks.client,
    repo: {},
    service: { getBoardDetail: mocks.getBoardDetail, setCells: mocks.setCells },
  }),
}));
vi.mock("@/lib/notify/board-actions", () => ({ notifyBoardItemMoved: mocks.notifyBoardItemMoved }));
vi.mock("next/server", () => ({
  after: (callback: () => void | Promise<void>) => {
    mocks.afterCallbacks.push(callback);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: () => ({ set: mocks.cookieSet }) }));

import { saveCellValueAction } from "./cell-save-actions";

function cellForm(input: { columnKey: string; value: string; kind?: string }): FormData {
  const form = new FormData();
  form.set("boardId", "board-1");
  form.set("itemId", "item-1");
  form.set("columnKey", input.columnKey);
  if (input.kind) form.set("kind", input.kind);
  form.set("value", input.value);
  return form;
}

describe("saveCellValueAction", () => {
  beforeEach(() => {
    mocks.setCells.mockClear();
    mocks.getBoardDetail.mockClear();
    mocks.notifyBoardItemMoved.mockClear();
    mocks.revalidatePath.mockClear();
    mocks.cookieSet.mockClear();
    mocks.client.from.mockClear();
    mocks.afterCallbacks.length = 0;
    mocks.state.perm = { kind: "allowed" };
    mocks.state.memberIds = ["member-1"];
  });

  it("텍스트 칸 저장은 행 결과를 돌려주고 전체 새로고침을 걸지 않는다", async () => {
    const result = await saveCellValueAction(cellForm({ columnKey: "memo", value: "새 값" }));
    expect(result).toEqual({ ok: true, item: mocks.savedRow, errors: [], notices: [] });
    expect(mocks.setCells).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("상태 칸 저장은 알림을 응답 뒤로 미룬다", async () => {
    const result = await saveCellValueAction(cellForm({ columnKey: "status", value: "opt-doing" }));
    expect(result.ok).toBe(true);
    expect(mocks.notifyBoardItemMoved).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(1);
    const run = mocks.afterCallbacks[0];
    if (run) await run();
    expect(mocks.notifyBoardItemMoved).toHaveBeenCalledTimes(1);
    expect(mocks.notifyBoardItemMoved).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }),
      expect.objectContaining({ boardId: "board-1", itemId: "item-1" }),
    );
  });

  it("권한이 없으면 저장하지 않고 그 이유를 돌려준다", async () => {
    mocks.state.perm = { kind: "denied", reason: "permission" };
    const result = await saveCellValueAction(cellForm({ columnKey: "memo", value: "새 값" }));
    expect(mocks.setCells).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      errors: [{ key: "memo", label: "memo", message: "이 업무를 실행할 권한이 없어요." }],
    });
  });

  it("파일 값은 다시 그리라는 안내로 돌려주고 저장하지 않는다", async () => {
    const form = cellForm({ columnKey: "memo", value: "새 값" });
    form.set("value", new File(["x"], "a.txt"));
    const result = await saveCellValueAction(form);
    expect(mocks.setCells).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      errors: [{ key: "memo", label: "memo", message: "이 칸은 화면을 새로 고친 뒤 다시 저장해 주세요." }],
    });
  });

  it("이 회사 멤버가 아닌 사람은 저장하지 않는다", async () => {
    mocks.state.memberIds = [];
    const result = await saveCellValueAction(
      cellForm({ columnKey: "owner_person", value: "outsider-1", kind: "person" }),
    );
    expect(mocks.setCells).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      errors: [{ key: "owner_person", label: "owner_person", message: "이 회사에 속한 사람만 선택할 수 있어요." }],
    });
  });

  it("Issue 857 검토 — 항목 편집 권한(work.item_upsert)을 이 회사로 확인한다", async () => {
    permCalls.length = 0;
    const form = new FormData();
    form.set("boardId", "board-1"); form.set("itemId", "item-1"); form.set("columnKey", "memo"); form.set("value", "x");
    await saveCellValueAction(form);
    expect(permCalls).toContainEqual(["org-1", "work.item_upsert"]);
  });

  it.each([
    ["contact_move", "컨택 이동"],
    ["consult_status", "리드컨택으로 넘기기"],
  ])("Issue 857 검토 — %s 의 다른 탭 보내기는 이 경로로 저장하지 않는다", async (columnKey, value) => {
    mocks.setCells.mockClear();
    const form = new FormData();
    form.set("boardId", "board-1"); form.set("itemId", "item-1"); form.set("columnKey", columnKey); form.set("value", value);
    const result = await saveCellValueAction(form);
    expect(result.ok).toBe(false);
    expect(mocks.setCells).not.toHaveBeenCalled();
  });
});
