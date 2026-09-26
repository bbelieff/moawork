import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  loadPermGuardMock,
  createRequestBoardsMock,
  rpcMock,
  createCanonicalMock,
  service,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  loadPermGuardMock: vi.fn(),
  createRequestBoardsMock: vi.fn(),
  rpcMock: vi.fn(),
  createCanonicalMock: vi.fn(),
  service: {
    getBoardDetail: vi.fn(),
    getItem: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: loadPermGuardMock }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: createRequestBoardsMock,
  requireRequestClient: (client: unknown) => {
    if (!client) throw new Error("연결된 워크스페이스가 필요합니다");
    return client;
  },
}));
vi.mock("@/lib/new-lead/mutations", () => ({
  NewLeadMutationError: class extends Error {},
  createCanonicalNewLead: createCanonicalMock,
}));

import { bulkArchiveAction, bulkRestoreArchivedAction } from "./bulk-archive-actions";
import { bulkDuplicateAction } from "./bulk-duplicate-actions";
import { bulkSetParentAction } from "./bulk-link-actions";

const OWNER_CTX = {
  org: { id: "org-1" },
  user: { id: "actor-1" },
  role: "owner",
  scope: "all",
};

const CLIENT = { rpc: rpcMock };

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(OWNER_CTX);
  loadPermGuardMock.mockResolvedValue({ kind: "allowed" });
  createRequestBoardsMock.mockResolvedValue({ client: CLIENT, service, repo: {} });
  service.getBoardDetail.mockResolvedValue({
    board: { id: "board-1", is_system: false, source: "user" },
    columns: [],
    groups: [{ id: "group-a", name: "A" }],
  });
  service.getItem.mockImplementation(async (_ctx: unknown, boardId: string, itemId: string) => ({
    id: itemId,
    board_id: boardId,
    group_id: "group-a",
    title: "원본",
    deal_id: null,
    assigned_to: null,
    values: { rep_name: "홍길동", phone: "010-0000-0000" },
  }));
});

describe("bulkArchive — 보호 RPC만 쓰고 약한 경로로 fallback하지 않는다", () => {
  it("권한 없으면 RPC를 부르지 않고 전건 실패", async () => {
    loadPermGuardMock.mockResolvedValueOnce({ kind: "denied", reason: "permission" });
    const result = await bulkArchiveAction({ boardId: "board-1", items: ["a", "b"] });
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(2);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("시스템 보드는 쓰기 전에 거부", async () => {
    service.getBoardDetail.mockResolvedValueOnce({
      board: { id: "board-1", is_system: true, source: "user" },
      columns: [],
      groups: [],
    });
    const result = await bulkArchiveAction({ boardId: "board-1", items: ["a"] });
    expect(result.failed).toBe(1);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("성공/실패를 건별로 나누고 성공분 메시지를 남긴다", async () => {
    rpcMock
      .mockResolvedValueOnce({ error: null, data: [{ item_id: "a", archived_at: "2026-09-26T00:00:00Z", replayed: false }] })
      .mockResolvedValueOnce({ error: { code: "22023", message: "item is already archived" }, data: null });
    const result = await bulkArchiveAction({
      boardId: "board-1",
      items: [{ id: "a", expectedUpdatedAt: "2026-09-25T00:00:00Z" }, { id: "b" }],
    });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0][0]).toBe("archive_board_item_atomic");
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((entry) => entry.itemId === "b")?.message).toMatch(/이미 보관/);
  });

  it("RPC 미적용(42883)은 준비 중 메시지로 닫고 다른 쓰기를 하지 않는다", async () => {
    rpcMock.mockResolvedValue({ error: { code: "42883", message: "function does not exist" }, data: null });
    const result = await bulkArchiveAction({ boardId: "board-1", items: ["a"] });
    expect(result.failed).toBe(1);
    expect(result.results[0].message).toMatch(/준비 중/);
    expect(result.results[0].message).not.toMatch(/153|초안|총괄/);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("같은 묶음 키 재시도는 항목별 같은 requestId를 보낸다 (중복 방지)", async () => {
    rpcMock.mockResolvedValue({ error: null, data: [{ item_id: "a", archived_at: "2026-09-26T00:00:00Z", replayed: false }] });
    await bulkArchiveAction({ boardId: "board-1", items: ["a"], idempotencyKey: "bulk-stable-1" });
    await bulkArchiveAction({ boardId: "board-1", items: ["a"], idempotencyKey: "bulk-stable-1" });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0][1].p_request_id).toBe(rpcMock.mock.calls[1][1].p_request_id);
    expect(rpcMock.mock.calls[0][1].p_request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("보관복구는 restore RPC를 쓴다", async () => {
    rpcMock.mockResolvedValue({ error: null, data: [{ item_id: "a", replayed: false }] });
    const result = await bulkRestoreArchivedAction({ boardId: "board-1", items: ["a"] });
    expect(rpcMock.mock.calls[0][0]).toBe("restore_archived_board_item_atomic");
    expect(result.applied).toBe(1);
  });
});

describe("bulkSetParent — 자기참조는 RPC 전에 거른다", () => {
  it("부모와 같은 id는 RPC를 부르지 않고 명시 실패", async () => {
    rpcMock.mockResolvedValue({ error: null, data: [{ item_id: "b", parent_item_id: "a", replayed: false }] });
    const result = await bulkSetParentAction({ boardId: "board-1", items: ["a", "b"], parentItemId: "a" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_item_id: "b", p_parent_item_id: "a" });
    expect(result.results.find((entry) => entry.itemId === "a")?.message).toMatch(/자기 자신/);
  });

  it("순환 거부는 RPC 메시지를 그대로 전한다", async () => {
    rpcMock.mockResolvedValue({ error: { code: "22023", message: "parent link would create a cycle" }, data: null });
    const result = await bulkSetParentAction({ boardId: "board-1", items: ["b"], parentItemId: "a" });
    expect(result.failed).toBe(1);
    expect(result.results[0].message).toMatch(/순환/);
  });
});

describe("bulkDuplicate — 일반은 단순 RPC, 정본 딜 계열은 원자 복제 한 번", () => {
  it("일반 보드는 duplicate RPC 한 번으로 끝낸다", async () => {
    rpcMock.mockResolvedValue({
      error: null,
      data: [{ source_item_id: "a", new_item_id: "n1", copied_values: 2, skipped_values: 1, replayed: false }],
    });
    const result = await bulkDuplicateAction({ boardId: "board-1", itemIds: ["a"] });
    expect(rpcMock.mock.calls[0][0]).toBe("duplicate_board_item_atomic");
    expect(result.results[0]).toMatchObject({ ok: true, newItemId: "n1" });
    expect(result.results[0].message).toMatch(/1개 제외/);
  });

  it("신규리드 보드는 정본 원자 복제 RPC 한 번으로 끝낸다 (2단계 아님)", async () => {
    service.getBoardDetail.mockResolvedValueOnce({
      board: { id: "board-1", is_system: false, source: "core.default-tab/new-lead" },
      columns: [],
      groups: [{ id: "group-a", name: "A" }],
    });
    rpcMock.mockResolvedValue({
      error: null,
      data: [{ source_item_id: "a", new_item_id: "n1", new_deal_id: "d2", company_id: "c1", copied_values: 2, skipped_values: 0, replayed: false }],
    });
    const result = await bulkDuplicateAction({ boardId: "board-1", itemIds: ["a"] });
    expect(createCanonicalMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe("duplicate_canonical_deal_item_atomic");
    expect(result.results[0]).toMatchObject({ ok: true, newItemId: "n1" });
  });

  it("contact·계약업무 보드도 같은 원자 복제 RPC를 쓴다", async () => {
    for (const source of ["core.default-tab/contact", "core.default-tab/contract-work"]) {
      rpcMock.mockClear();
      service.getBoardDetail.mockResolvedValueOnce({
        board: { id: "board-1", is_system: false, source },
        columns: [],
        groups: [],
      });
      rpcMock.mockResolvedValue({
        error: null,
        data: [{ source_item_id: "a", new_item_id: "n1", new_deal_id: "d2", company_id: null, copied_values: 0, skipped_values: 0, replayed: false }],
      });
      const result = await bulkDuplicateAction({ boardId: "board-1", itemIds: ["a"] });
      expect(rpcMock.mock.calls[0][0]).toBe("duplicate_canonical_deal_item_atomic");
      expect(result.results[0]).toMatchObject({ ok: true, newItemId: "n1" });
    }
    expect(createCanonicalMock).not.toHaveBeenCalled();
  });

  it("같은 묶음 키 재시도는 복제도 같은 requestId·새 ID를 보낸다", async () => {
    rpcMock.mockResolvedValue({
      error: null,
      data: [{ source_item_id: "a", new_item_id: "n1", copied_values: 1, skipped_values: 0, replayed: true }],
    });
    await bulkDuplicateAction({ boardId: "board-1", itemIds: ["a"], idempotencyKey: "bulk-dup-1" });
    await bulkDuplicateAction({ boardId: "board-1", itemIds: ["a"], idempotencyKey: "bulk-dup-1" });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0][1].p_request_id).toBe(rpcMock.mock.calls[1][1].p_request_id);
    expect(rpcMock.mock.calls[0][1].p_new_item_id).toBe(rpcMock.mock.calls[1][1].p_new_item_id);
  });
});
