import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  loadPermGuardMock,
  createRequestBoardsMock,
  service,
  lineageRead,
  lineageReassign,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  loadPermGuardMock: vi.fn(),
  createRequestBoardsMock: vi.fn(),
  service: {
    getBoardDetail: vi.fn(),
    getItem: vi.fn(),
    setCells: vi.fn(),
    updateItem: vi.fn(),
    moveRowAtomic: vi.fn(),
  },
  lineageRead: vi.fn(),
  lineageReassign: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: loadPermGuardMock }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: createRequestBoardsMock }));
vi.mock("@/lib/assignment-lineage", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/assignment-lineage")>();
  return {
    ...orig,
    SupabaseAssignmentLineageRepo: class {
      constructor(public readonly client: unknown) {}
    },
    AssignmentLineageService: class {
      constructor(public readonly repo: unknown) {}
      read = lineageRead;
      reassign = lineageReassign;
    },
  };
});

import {
  bulkApplyCellsAction,
  bulkAssignAction,
  bulkMoveGroupAction,
} from "./bulk-actions";

const OWNER_CTX = {
  org: { id: "org-1" },
  user: { id: "actor-1" },
  role: "owner",
  scope: "all",
};

function column(key: string, over: Record<string, unknown> = {}) {
  return {
    id: `col-${key}`,
    org_id: "org-1",
    board_id: "board-1",
    key,
    label: key,
    type: "text",
    source: "in",
    rightPinned: false,
    options_jsonb: null,
    sort_order: 0,
    width: null,
    is_readonly: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(OWNER_CTX);
  loadPermGuardMock.mockResolvedValue({ kind: "allowed" });
  createRequestBoardsMock.mockResolvedValue({ client: null, service, repo: {} });
  service.getBoardDetail.mockResolvedValue({
    board: { id: "board-1", is_system: false, row_order_version: 7 },
    columns: [column("status"), column("due", { type: "date" })],
    groups: [{ id: "group-a", name: "A" }],
  });
  service.getItem.mockImplementation(async (_ctx: unknown, boardId: string, itemId: string) => {
    if (boardId !== "board-1") throw new Error("아이템을 찾을 수 없습니다");
    return { id: itemId, board_id: boardId, group_id: "group-a", deal_id: null, assigned_to: null, values: {} };
  });
  service.setCells.mockResolvedValue({ errors: [] });
  service.updateItem.mockResolvedValue({});
  service.moveRowAtomic.mockImplementation(async (_ctx: unknown, _board: string, request: { itemId: string; expectedVersion: number }) => ({
    itemId: request.itemId,
    targetGroupId: "group-a",
    beforeItemId: null,
    version: request.expectedVersion + 1,
    replayed: false,
  }));
  lineageRead.mockResolvedValue({ currentAssigneeId: "user-old", version: 3 });
  lineageReassign.mockResolvedValue({ accepted: true, version: 4 });
});

describe("bulkApplyCells — 없는 칸 거짓 성공 방지", () => {
  it("정의되지 않은 컬럼은 건별 실패로 돌리고 setCells 를 부르지 않는다", async () => {
    const result = await bulkApplyCellsAction({
      boardId: "board-1",
      itemIds: ["item-a", "item-b"],
      columnKey: "no-such-column",
      value: "x",
      workflowKind: null,
    });
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.results.every((entry) => !entry.ok)).toBe(true);
    expect(service.setCells).not.toHaveBeenCalled();
  });

  it("읽기전용 칸은 쓰기 전에 막는다", async () => {
    service.getBoardDetail.mockResolvedValueOnce({
      board: { id: "board-1", is_system: false, row_order_version: 0 },
      columns: [column("calc", { is_readonly: true })],
      groups: [],
    });
    const result = await bulkApplyCellsAction({
      boardId: "board-1",
      itemIds: ["item-a"],
      columnKey: "calc",
      value: "x",
      workflowKind: null,
    });
    expect(result.failed).toBe(1);
    expect(service.setCells).not.toHaveBeenCalled();
  });
});

describe("bulkAssign — 정본 lineage + 소속 사전 확인", () => {
  it("다른 보드 행은 쓰기 전에 거부하고 updateItem 을 부르지 않는다", async () => {
    service.getItem.mockRejectedValueOnce(new Error("아이템을 찾을 수 없습니다"));
    const result = await bulkAssignAction({ boardId: "board-1", itemIds: ["other-board-item"], assigneeId: null });
    expect(result.failed).toBe(1);
    expect(result.results[0]?.ok).toBe(false);
    expect(service.updateItem).not.toHaveBeenCalled();
    expect(lineageReassign).not.toHaveBeenCalled();
  });

  it("deal 연결 행은 lineage RPC 로 넘기고 updateItem 을 쓰지 않는다", async () => {
    const memberChain = {
      select: () => memberChain,
      eq: () => memberChain,
      in: async () => ({ error: null, data: [{ user_id: "user-new" }] }),
    };
    createRequestBoardsMock.mockResolvedValueOnce({
      client: { rpc: vi.fn(), from: () => memberChain },
      service: {
        ...service,
        getItem: vi.fn(async () => ({ id: "item-deal", board_id: "board-1", deal_id: "deal-1", values: {} })),
      },
      repo: {},
    });
    const result = await bulkAssignAction({ boardId: "board-1", itemIds: ["item-deal"], assigneeId: "user-new" });
    expect(result.applied).toBe(1);
    expect(lineageRead).toHaveBeenCalled();
    expect(lineageReassign).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      expect.objectContaining({ boardId: "board-1", dealId: "deal-1", itemId: "item-deal", assignedTo: "user-new" }),
    );
    expect(service.updateItem).not.toHaveBeenCalled();
  });

  it("비연결 행의 전체가시 scope 가 아니면 거짓 성공 대신 실패한다", async () => {
    getSessionMock.mockResolvedValueOnce({ org: { id: "org-1" }, user: { id: "member-1" }, role: "member", scope: "assigned" });
    const result = await bulkAssignAction({ boardId: "board-1", itemIds: ["item-a"], assigneeId: "user-new" });
    expect(result.failed).toBe(1);
    expect(service.updateItem).not.toHaveBeenCalled();
  });
});

describe("bulkMove — moveRowAtomic 정본", () => {
  it("직접 group_id 쓰기 대신 moveRowAtomic 을 쓰고 버전을 추적한다", async () => {
    const result = await bulkMoveGroupAction({ boardId: "board-1", itemIds: ["item-a", "item-b"], groupId: "group-a" });
    expect(result.applied).toBe(2);
    expect(service.updateItem).not.toHaveBeenCalled();
    expect(service.moveRowAtomic).toHaveBeenCalledTimes(2);
    expect(service.moveRowAtomic).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "board-1",
      expect.objectContaining({ itemId: "item-a", targetGroupId: "group-a", beforeItemId: null, expectedVersion: 7 }),
    );
    expect(service.moveRowAtomic).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "board-1",
      expect.objectContaining({ itemId: "item-b", expectedVersion: 8 }),
    );
  });

  it("다른 보드 행은 이동 전에 거부한다", async () => {
    service.getItem.mockRejectedValueOnce(new Error("아이템을 찾을 수 없습니다"));
    const result = await bulkMoveGroupAction({ boardId: "board-1", itemIds: ["other"], groupId: "group-a" });
    expect(result.failed).toBe(1);
    expect(service.moveRowAtomic).not.toHaveBeenCalled();
  });
});
