import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn } from "@/lib/boards/types";

const mocks = vi.hoisted(() => ({
  guard: "allowed",
  columns: [] as BoardColumn[],
  updated: [] as { boardId: string; columnId: string; options: unknown }[],
  revalidate: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-1" }, user: { id: "user-1" }, role: "admin", scope: "all" })),
}));
vi.mock("@/lib/perm/guard", () => ({
  loadPermGuard: vi.fn(async () => ({ kind: mocks.guard })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: mocks.rpc })),
}));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: vi.fn(async () => ({
    service: {
      getBoardDetail: vi.fn(async () => ({ columns: mocks.columns.map((c) => structuredClone(c)) })),
      updateColumn: vi.fn(async (_ctx: unknown, boardId: string, columnId: string, patch: { options?: unknown }) => {
        mocks.updated.push({ boardId, columnId, options: patch.options });
        const target = mocks.columns.find((c) => c.id === columnId);
        if (!target) return undefined;
        target.options_jsonb = { options: structuredClone(patch.options) as never };
        return target;
      }),
    },
  })),
}));

import { addBoardLabelOptionAction } from "./label-option-actions";

function column(overrides: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: "col-1",
    board_id: "board-1",
    org_id: "org-1",
    key: "fund_name",
    label: "상품명칭",
    type: "select",
    source: "act",
    rightPinned: false,
    options_jsonb: {
      options: [
        { id: "혁신성장자금", label: "혁신성장자금", order: 0, color: "#00c875" },
        { id: "재도전특별자금", label: "재도전특별자금", order: 1 },
      ],
    },
    sort_order: 0,
    width: null,
    move_rule_jsonb: null,
    ...overrides,
  } as BoardColumn;
}

const INPUT = { boardId: "board-1", columnId: "col-1", label: "새 라벨", requestId: "req-1" };

describe("라벨 만들기 액션 (155 원자 경로)", () => {
  beforeEach(() => {
    mocks.guard = "allowed";
    mocks.columns = [column()];
    mocks.updated = [];
    mocks.revalidate.mockReset();
    mocks.rpc.mockReset().mockResolvedValue({
      data: [{ option_id: "새 라벨", created: true, replayed: false }],
      error: null,
    });
  });

  it("RPC로 만들고 예전 쓰기는 타지 않는다 — 스냅샷을 보내지 않는다", async () => {
    const result = await addBoardLabelOptionAction(INPUT);
    expect(result).toEqual({ ok: true, optionId: "새 라벨", message: "«새 라벨»(을)를 만들었어요." });
    expect(mocks.rpc).toHaveBeenCalledWith("append_board_column_label_option", {
      p_org_id: "org-1",
      p_board_id: "board-1",
      p_column_id: "col-1",
      p_request_id: "req-1",
      p_label: "새 라벨",
    });
    expect(mocks.updated).toHaveLength(0);
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-1");
  });

  it("RPC 중복은 만들지 않고 기존 id 를 돌려준다 — 쿼리 유지용 충돌 실패", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ option_id: "혁신성장자금", created: false, replayed: false }],
      error: null,
    });
    const result = await addBoardLabelOptionAction({ ...INPUT, label: "  혁신성장자금 " });
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.optionId).toBe("혁신성장자금");
    expect(mocks.updated).toHaveLength(0);
  });

  it("RPC 보호 컬럼 판정은 그대로 거절하고 예전 쓰기로 넘어가지 않는다", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "label append protected column" },
    });
    const result = await addBoardLabelOptionAction(INPUT);
    expect(result.ok).toBe(false);
    expect(mocks.updated).toHaveLength(0);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("RPC 권한 없음·열쇠 재사용은 답으로 끝낸다 — 성공 뒤 재쓰기 없음", async () => {
    for (const error of [
      { code: "42501", message: "label append permission denied" },
      { code: "22023", message: "label append idempotency key reuse" },
    ]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error });
      const result = await addBoardLabelOptionAction(INPUT);
      expect(result.ok).toBe(false);
    }
    expect(mocks.updated).toHaveLength(0);
  });

  it("컬럼 관리 권한이 없으면 RPC도 타지 않는다 — 역할 완화를 안 한다", async () => {
    mocks.guard = "denied";
    const result = await addBoardLabelOptionAction(INPUT);
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updated).toHaveLength(0);
  });
});

describe("라벨 만들기 155 미적용 — fail-closed, 쓰기 없음", () => {
  beforeEach(() => {
    mocks.guard = "allowed";
    mocks.columns = [column()];
    mocks.updated = [];
    mocks.revalidate.mockReset();
    mocks.rpc.mockReset().mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
  });

  it("155가 없으면 만들지 않고 끝낸다 — 전체 교체로 동시 라벨을 잃지 않는다", async () => {
    const result = await addBoardLabelOptionAction(INPUT);
    expect(result.ok).toBe(false);
    expect(result.optionId).toBeUndefined();
    expect(mocks.updated).toHaveLength(0);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("42883도 같은 fail-closed다 — 쓰기 없음", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42883", message: 'function does not exist' },
    });
    const result = await addBoardLabelOptionAction({ ...INPUT, label: "  혁신성장자금 " });
    expect(result.ok).toBe(false);
    expect(result.optionId).toBeUndefined();
    expect(mocks.updated).toHaveLength(0);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("보호 컬럼이어도 155 없이는 RPC 답 없이 fail-closed다", async () => {
    mocks.columns = [column({ key: "consult_status" })];
    const result = await addBoardLabelOptionAction(INPUT);
    expect(result.ok).toBe(false);
    expect(mocks.updated).toHaveLength(0);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
