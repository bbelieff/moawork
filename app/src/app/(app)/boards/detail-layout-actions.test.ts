import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  setBoardLayout: vi.fn(),
  setGroupLayout: vi.fn(),
  setValues: vi.fn(),
  createColumn: vi.fn(),
  getItem: vi.fn(),
  detail: {
    board: { id: "board-a", org_id: "org-a", source: null as string | null, detail_layout_jsonb: [{ key: "detail_note", source: "detail", label: "메모", type: "text" }] },
    columns: [] as Array<Record<string, unknown>>,
    groups: [{ id: "group-a", org_id: "org-a", board_id: "board-a", detail_layout_jsonb: null }],
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "user-a" }, role: "owner", scope: "all" })) }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    service: { getBoardDetail: vi.fn(async () => mocks.detail) },
    repo: {
      getItem: mocks.getItem,
      setValues: mocks.setValues,
      createColumn: mocks.createColumn,
      setBoardDetailLayout: mocks.setBoardLayout,
      setGroupDetailLayout: mocks.setGroupLayout,
    },
  }),
}));

import {
  addDetailFieldAction,
  promoteDetailFieldAction,
  saveDetailLayoutAction,
  setDetailValueAction,
} from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("BBE-107 action permission/value preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ kind: "allowed" });
    mocks.getItem.mockResolvedValue({ id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a" });
    mocks.detail.columns = [];
    mocks.detail.board.source = null;
    mocks.detail.board.detail_layout_jsonb = [{ key: "detail_note", source: "detail", label: "메모", type: "text" }];
    mocks.detail.groups[0].detail_layout_jsonb = null;
  });

  it("권한이 없으면 layout 저장소를 호출하지 않는다", async () => {
    mocks.guard.mockResolvedValue({ kind: "denied", reason: "permission" });
    // BBE-213: 던지지 않는다. 보안 성질(저장소 미호출)은 아래에서 그대로 단언한다.
    await expect(saveDetailLayoutAction(form({ boardId: "board-a", groupId: "group-a", layout: "[]" }))).resolves.toBeUndefined();
    expect(mocks.setGroupLayout).not.toHaveBeenCalled();
  });

  it("현재 배치의 상세 전용 값만 assigned item에 저장한다", async () => {
    await setDetailValueAction(form({ boardId: "board-a", itemId: "item-a", fieldKey: "detail_note", value: "보존" }));
    expect(mocks.guard).toHaveBeenCalledWith("org-a", "work.item_upsert");
    expect(mocks.setValues).toHaveBeenCalledWith(expect.objectContaining({ org: { id: "org-a" } }), "item-a", { detail_note: "보존" });
  });

  it("상세 필드 승격은 같은 key의 컬럼과 layout만 바꾸며 값 행은 건드리지 않는다", async () => {
    await promoteDetailFieldAction(form({ boardId: "board-a", fieldKey: "detail_note" }));
    expect(mocks.createColumn).toHaveBeenCalledWith(expect.anything(), "board-a", expect.objectContaining({ key: "detail_note", label: "메모" }));
    expect(mocks.setBoardLayout).toHaveBeenCalledWith(expect.anything(), "board-a", [expect.objectContaining({ key: "detail_note", source: "column" })]);
    expect(mocks.setValues).not.toHaveBeenCalled();
  });

  it("canonical 신규리드의 빈 DB 기본 배치에 추가해도 기존 표 필드 fallback을 보존한다", async () => {
    mocks.detail.board.source = "core.default-tab/new-lead";
    mocks.detail.board.detail_layout_jsonb = [];
    mocks.detail.columns = [{ key: "owner", label: "담당자", type: "person" }];

    await addDetailFieldAction(form({ boardId: "board-a", groupId: "group-a", label: "신용등급", type: "text" }));

    expect(mocks.setGroupLayout).toHaveBeenCalledWith(expect.anything(), "group-a", [
      expect.objectContaining({ key: "owner", source: "column" }),
      expect.objectContaining({ key: "detail_신용등급", source: "detail", label: "신용등급" }),
    ]);
  });
});
