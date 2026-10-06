import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-10-06 검토 P1 — 상세 자동저장(글자) 경로가 담당자(person)·구성원(people) 칸을 받으면
 * 이름·오타가 그대로 담당자로 저장됐다(person 검증은 아직 구성원 여부를 보지 않는다).
 * 경계(세션·권한·supabase·보드 그래프)만 모킹하고 실제 saveItemDetailFieldAction 을 부른다.
 */

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000010",
  board: "00000000-0000-4000-8000-000000000020",
  item: "00000000-0000-4000-8000-000000000030",
};

const mocks = vi.hoisted(() => ({
  setCells: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({
    org: { id: ids.org },
    user: { id: ids.user },
    role: "owner",
    scope: "all",
  })),
}));
vi.mock("@/lib/perm/guard", () => ({
  loadPermGuard: vi.fn(async () => ({ kind: "allowed" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is"]) builder[method] = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(async () => ({
        data: { id: ids.item, board_id: ids.board, org_id: ids.org, assigned_to: ids.user, deleted_at: null },
        error: null,
      }));
      return builder;
    },
  })),
}));
vi.mock("@/lib/deal/members", () => ({ listOrgMemberOptions: vi.fn(async () => []) }));
vi.mock("@/lib/notices/official-file", () => ({
  BOARD_ITEM_FILES_BUCKET: "board-item-files",
  boardItemStoragePath: vi.fn(),
  encodeNoticeFile: vi.fn(),
}));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: vi.fn(async () => ({
    service: {
      getBoardDetail: vi.fn(async () => ({
        board: { id: ids.board, source: "core.default-tab/contract-work", detail_layout_jsonb: [] },
        columns: [
          { key: "owner", label: "담당자", type: "person", source: "act", options_jsonb: null },
          { key: "team", label: "참여자", type: "people", source: "act", options_jsonb: null },
          { key: "memo", label: "메모", type: "text", source: "in", options_jsonb: null },
        ],
        groups: [],
      })),
      setCells: mocks.setCells,
    },
    repo: {},
  })),
}));

import { saveItemDetailFieldAction } from "./item-detail-actions";

describe("상세 글자 저장은 구성원 칸을 바꾸지 않는다", () => {
  beforeEach(() => {
    mocks.setCells.mockReset().mockResolvedValue({ errors: [] });
  });

  it.each([
    ["owner", "담당자는"],
    ["team", "참여자는"],
  ])("%s 칸에 글자를 보내면 쓰지 않고 거부한다", async (fieldKey, subject) => {
    const result = await saveItemDetailFieldAction({
      boardId: ids.board,
      itemId: ids.item,
      fieldKey,
      source: "column",
      value: "홍길동",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBe(`${subject} 표에서 구성원을 골라 바꿔 주세요. 저장하지 않았습니다.`);
    expect(mocks.setCells).not.toHaveBeenCalled();
  });

  it("일반 글자 칸은 그대로 저장한다", async () => {
    const result = await saveItemDetailFieldAction({
      boardId: ids.board,
      itemId: ids.item,
      fieldKey: "memo",
      source: "column",
      value: "통화 완료",
    });
    expect(result).toEqual({ ok: true, message: "✓ 자동 저장됨" });
    expect(mocks.setCells).toHaveBeenCalledWith(
      expect.anything(),
      ids.board,
      ids.item,
      { memo: "통화 완료" },
      expect.any(String),
    );
  });
});
