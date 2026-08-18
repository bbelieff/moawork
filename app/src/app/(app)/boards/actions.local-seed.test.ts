// 로컬 시드(연결된 워크스페이스 없음)에서 보드 액션이 어떻게 행동하는가 — BBE-209.
//
// 이 파일이 지키는 구분은 하나다:
//
//   «사용자가 누른 그 동작» 이 못 되면 → 말한다(오류를 보여준다).
//   «그 동작에 딸린 쓰기 부작용» 이 못 되면 → 동작 자체를 실패로 표시하지 않는다.
//
// 두 번째를 지키지 않으면 «실제로 이동은 됐는데 화면은 오류» 가 된다. 성공을 실패로
// 표시하는 것이고 BBE-183·BBE-193·BBE-201 이 반복해서 잡아 온 결함이다.
// 그래서 이동 알림(Supabase RPC)은 client 가 없으면 «건너뛴다» — 그런데 건너뛰기는
// 조용해서 눈으로 못 본다. 여기서 대신 본다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  setCells,
  updateItem,
  listItems,
  notifyBoardItemMoved,
  advanceNewLeadToContact,
  cookieSet,
  graph,
} = vi.hoisted(() => ({
  setCells: vi.fn(async () => ({ errors: [] })),
  updateItem: vi.fn(async () => undefined),
  listItems: vi.fn(async () => [
    { id: "item-1", group_id: "group-a", sort_order: 0 },
    { id: "item-2", group_id: "group-b", sort_order: 0 },
  ]),
  notifyBoardItemMoved: vi.fn(async () => 1),
  advanceNewLeadToContact: vi.fn(async () => ({ status: "committed" })),
  cookieSet: vi.fn(),
  // 「건너뛴다」가 「아예 안 부른다」와 다르다는 것을 이 파일 «안에서» 보려면
  // 연결된 경우도 같은 파일에서 돌려야 한다. 그래서 client 를 바꿀 수 있게 둔다.
  graph: { client: null as null | { rpc: () => void } },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet, delete: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({
    org: { id: "org-1", name: "회사" },
    user: { id: "member-1", name: "멤버", email: "member@example.test" },
    role: "member",
    scope: "all",
  }),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: async () => ({ kind: "allowed" }) }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: async () => ({ ok: true }) }));
// ★ 이 파일의 전제 — 로컬 시드에는 원본 Supabase 클라이언트가 «없다».
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    client: graph.client,
    service: { setCells, updateItem, listItems },
  }),
}));
vi.mock("@/lib/notify/board-actions", () => ({ notifyBoardItemMoved }));
vi.mock("@/lib/new-lead/advance", () => ({
  advanceNewLeadToContact,
  NewLeadAdvanceError: class NewLeadAdvanceError extends Error {},
}));

import { moveItemAction, moveRowAction, setCellAction } from "./actions";

function form(entries: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(entries)) result.set(key, value);
  return result;
}

describe("보드 액션 — 로컬 시드", () => {
  beforeEach(() => {
    setCells.mockClear();
    updateItem.mockClear();
    listItems.mockClear();
    notifyBoardItemMoved.mockClear();
    advanceNewLeadToContact.mockClear();
    cookieSet.mockClear();
    graph.client = null; // 기본은 «로컬 시드»
  });

  it("① 칸반 이동: 이동은 커밋되고, 알림만 조용히 건너뛴다", async () => {
    await expect(moveItemAction(form({
      boardId: "board-1",
      itemId: "item-1",
      lane: "group-b",
      groupBy: "status",
    }))).resolves.toBeUndefined();

    // 사용자가 누른 그 동작은 실제로 일어났다.
    expect(setCells).toHaveBeenCalledTimes(1);
    // 딸린 쓰기 부작용만 빠졌다.
    expect(notifyBoardItemMoved).not.toHaveBeenCalled();
  });

  it("② 행 이동: 이동은 커밋되고, 알림만 조용히 건너뛴다", async () => {
    await expect(moveRowAction(form({
      boardId: "board-1",
      itemId: "item-1",
      groupId: "group-b",
      index: "0",
    }))).resolves.toBeUndefined();

    expect(updateItem).toHaveBeenCalled();
    expect(notifyBoardItemMoved).not.toHaveBeenCalled();
  });

  it("★③ 던지지 않는 것이 «이동이 취소된다» 는 뜻이 아니다 — 쓰기 순서를 고정한다", async () => {
    // 이 단언이 없으면 「알림을 건너뛴다」를 「이동 자체를 건너뛴다」로 바꿔도 ①·②가 통과한다.
    // 던지지 않는 이유는 «이미 커밋됐기 때문» 이므로, 커밋이 실제로 먼저 일어났음을 봐야 한다.
    await moveItemAction(form({
      boardId: "board-1",
      itemId: "item-1",
      lane: "group-b",
      groupBy: "status",
    }));
    expect(setCells).toHaveBeenCalledWith(
      expect.anything(),
      "board-1",
      "item-1",
      { status: "group-b" },
    );
  });

  it("★④ 컨택 이동은 반대다 — 그것이 «누른 동작 자체» 라서 조용히 넘어가지 않는다", async () => {
    await expect(setCellAction(form({
      boardId: "board-1",
      itemId: "item-1",
      columnKey: "contact_move",
      value: "컨택 이동",
    }))).resolves.toBeUndefined();

    // 원본 클라이언트가 없으므로 실행 자체가 없었고,
    expect(advanceNewLeadToContact).not.toHaveBeenCalled();
    // 「눌렀는데 아무 일도 안 일어남」이 되지 않도록 셀 아래에 사유가 실린다.
    expect(cookieSet).toHaveBeenCalled();
  });

  it("★⑤ 대조군 — 연결되면 실제로 보낸다(«건너뛴다» 가 «아예 안 부른다» 가 아님을 이 파일에서 본다)", async () => {
    // 이 대조군이 없으면 알림 호출을 통째로 지워도 ①·②가 통과한다.
    // 그 방어를 이웃 파일(actions.move-notify.test.ts)에 맡기면,
    // 이웃을 리팩터하는 사람은 자기가 이 방어를 걷어냈다는 것을 모른다.
    graph.client = { rpc: () => undefined };
    await moveItemAction(form({
      boardId: "board-1",
      itemId: "item-1",
      lane: "group-b",
      groupBy: "status",
    }));
    expect(notifyBoardItemMoved).toHaveBeenCalledTimes(1);
  });
});
