import { beforeEach, describe, expect, it, vi } from "vitest";
import { presentNewLeadDetailLayout } from "@/lib/default-tabs/new-lead";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  setBoardLayout: vi.fn(),
  setGroupLayout: vi.fn(),
  setValues: vi.fn(),
  createColumn: vi.fn(),
  deleteColumn: vi.fn(),
  getItem: vi.fn(),
  detail: {
    board: { id: "board-a", org_id: "org-a", source: null as string | null, detail_layout_jsonb: [{ key: "detail_note", source: "detail", label: "메모", type: "text" }] as Array<Record<string, unknown>> },
    columns: [] as Array<Record<string, unknown>>,
    groups: [{ id: "group-a", org_id: "org-a", board_id: "board-a", detail_layout_jsonb: null as Array<Record<string, unknown>> | null }],
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
      deleteColumn: mocks.deleteColumn,
      setBoardDetailLayout: mocks.setBoardLayout,
      setGroupDetailLayout: mocks.setGroupLayout,
    },
  }),
}));

import {
  addDetailFieldAction,
  addUnplacedDetailEntryAction,
  demoteDetailFieldAction,
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
    mocks.setGroupLayout.mockImplementation(async (_ctx, groupId: string, layout: Array<Record<string, unknown>>) => {
      const group = mocks.detail.groups.find((candidate) => candidate.id === groupId);
      if (group) group.detail_layout_jsonb = layout;
    });
    mocks.setBoardLayout.mockImplementation(async (_ctx, _boardId: string, layout: Array<Record<string, unknown>>) => {
      mocks.detail.board.detail_layout_jsonb = layout;
    });
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

  /*
   * #654 — 같은 이름을 «또» 만들지 않는다.
   *
   * 전에는 이름이 겹치면 key 뒤에 _2, _3 … 을 붙여 조용히 하나 더 만들었다. 그래서
   * 응답이 늦을 때 사용자가 「안 눌렸나」 하고 다시 누르면 누른 만큼 쌓인다 —
   * 실제로 「법인공동인증서」가 16개 생겼고, 그 뒤 컬럼 명령이 통째로 죽어 있어서(#653)
   * 지울 방법도 없었다.
   *
   * ★ runBoardAction 이 오류를 삼켜 flash 로 바꾸므로 «던졌는가» 로 재지 않는다.
   *   «쓰지 않았는가» 로 잰다 — 사용자에게 중요한 것은 행이 안 생기는 것이다.
   */
  it("같은 이름의 상세 필드를 또 만들지 않는다 — 여러 번 눌러도 하나다", async () => {
    mocks.detail.board.detail_layout_jsonb = [
      { key: "detail_법인공동인증서", source: "detail", label: "법인공동인증서", type: "text" },
    ];
    mocks.detail.groups[0].detail_layout_jsonb = null;

    for (let press = 0; press < 3; press += 1) {
      await addDetailFieldAction(form({ boardId: "board-a", groupId: "group-a", label: "법인공동인증서", type: "text" }));
    }

    expect(mocks.setGroupLayout).not.toHaveBeenCalled();
    expect(mocks.setBoardLayout).not.toHaveBeenCalled();
  });

  it("이름이 다르면 그대로 만든다 — 막는 것은 «같은 이름» 하나뿐이다", async () => {
    mocks.detail.board.detail_layout_jsonb = [
      { key: "detail_법인공동인증서", source: "detail", label: "법인공동인증서", type: "text" },
    ];
    mocks.detail.groups[0].detail_layout_jsonb = null;

    await addDetailFieldAction(form({ boardId: "board-a", groupId: "group-a", label: "개인공동인증서", type: "text" }));

    expect(mocks.setGroupLayout).toHaveBeenCalledWith(expect.anything(), "group-a", [
      expect.objectContaining({ key: "detail_법인공동인증서" }),
      expect.objectContaining({ key: "detail_개인공동인증서", source: "detail", label: "개인공동인증서" }),
    ]);
  });

  it("canonical unplaced 금융 셀은 physical sibling만 저장하고 replay·reload에서 한 셀이다", async () => {
    mocks.detail.board.source = "core.default-tab/new-lead";
    mocks.detail.board.detail_layout_jsonb = [];
    mocks.detail.groups[0].detail_layout_jsonb = [];
    mocks.detail.columns = [
      { key: "credit_score_ncb", label: "회사 NCB", type: "number" },
      { key: "credit_score_kcb", label: "회사 KCB", type: "number" },
      { key: "revenue_band", label: "기존 매출구간", type: "select" },
      { key: "revenue_3y_million", label: "실제 매출", type: "number" },
    ];

    await addUnplacedDetailEntryAction(form({ boardId: "board-a", groupId: "group-a", fieldKey: "credit_scores" }));
    await addUnplacedDetailEntryAction(form({ boardId: "board-a", groupId: "group-a", fieldKey: "revenue_3y_million" }));
    await addUnplacedDetailEntryAction(form({ boardId: "board-a", groupId: "group-a", fieldKey: "credit_scores" }));

    const stored = mocks.detail.groups[0].detail_layout_jsonb as Array<Record<string, unknown>>;
    expect(stored.map((entry) => entry.key)).toEqual([
      "credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million",
    ]);
    expect(stored.some((entry) => entry.key === "credit_scores" || entry.source === "detail")).toBe(false);
    expect(stored.map((entry) => entry.label)).toEqual(["회사 NCB", "회사 KCB", "기존 매출구간", "실제 매출"]);
    expect(presentNewLeadDetailLayout(stored as unknown as Parameters<typeof presentNewLeadDetailLayout>[0]).map((entry) => entry.key))
      .toEqual(["credit_scores", "revenue_3y_million"]);
    expect(mocks.setGroupLayout).toHaveBeenCalledTimes(2);
  });

  it("canonical exact-layout replay is write-free while a new pair writes once", async () => {
    mocks.detail.board.source = "core.default-tab/new-lead";
    mocks.detail.board.detail_layout_jsonb = [];
    mocks.detail.columns = [
      { key: "credit_score_ncb", label: "회사 NCB", type: "number" },
      { key: "credit_score_kcb", label: "회사 KCB", type: "number" },
      { key: "revenue_band", label: "기존 매출구간", type: "select" },
      { key: "revenue_3y_million", label: "실제 매출", type: "number" },
    ];
    mocks.detail.groups[0].detail_layout_jsonb = [
      { key: "credit_score_ncb", source: "column", label: "회사 NCB", type: "number" },
      { key: "credit_score_kcb", source: "column", label: "회사 KCB", type: "number" },
    ];

    await addUnplacedDetailEntryAction(form({ boardId: "board-a", groupId: "group-a", fieldKey: "credit_scores" }));
    expect(mocks.setGroupLayout).not.toHaveBeenCalled();

    await addUnplacedDetailEntryAction(form({ boardId: "board-a", groupId: "group-a", fieldKey: "revenue_3y_million" }));
    expect(mocks.setGroupLayout).toHaveBeenCalledTimes(1);
  });

  it("cross-board synthetic credit restore fails closed without arbitrary layout synthesis", async () => {
    mocks.detail.board.source = "custom/board";
    mocks.detail.board.detail_layout_jsonb = [];
    mocks.detail.groups[0].detail_layout_jsonb = [];
    mocks.detail.columns = [];

    await expect(addUnplacedDetailEntryAction(form({ boardId: "board-a", groupId: "group-a", fieldKey: "credit_scores" })))
      .resolves.toBeUndefined();

    expect(mocks.setGroupLayout).not.toHaveBeenCalled();
    expect(mocks.setBoardLayout).not.toHaveBeenCalled();
    expect(mocks.createColumn).not.toHaveBeenCalled();
  });

  it("cross-board synthetic revenue restore fails closed when no physical column exists", async () => {
    mocks.detail.board.source = "custom/board";
    mocks.detail.board.detail_layout_jsonb = [];
    mocks.detail.groups[0].detail_layout_jsonb = [];
    mocks.detail.columns = [];

    await expect(addUnplacedDetailEntryAction(form({
      boardId: "board-a",
      groupId: "group-a",
      fieldKey: "revenue_3y_million",
    }))).resolves.toBeUndefined();

    expect(mocks.setGroupLayout).not.toHaveBeenCalled();
    expect(mocks.setBoardLayout).not.toHaveBeenCalled();
    expect(mocks.createColumn).not.toHaveBeenCalled();
  });
});

/*
 * #657 — 「표로 올리기」에 되돌리는 길을 낸다.
 *
 * 전에는 올리는 버튼만 있었고 그것도 source === "detail" 일 때만 그려져서,
 * 한 번 누르면 버튼 자체가 사라졌다. 되돌릴 수 없는 한 방향 문이었다.
 */
describe("#657 표로 올린 상세 필드를 다시 내린다", () => {
  beforeEach(() => {
    // ★ 이 describe 는 위 describe 의 beforeEach 를 못 받는다. 목 초기화를 여기서 직접 한다 —
    //   안 하면 앞 시험의 호출 수가 그대로 누적돼 «안 불렀다» 단언이 거짓으로 실패한다.
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ kind: "allowed" });
    mocks.setBoardLayout.mockImplementation(async (_ctx, _boardId: string, layout: Array<Record<string, unknown>>) => {
      mocks.detail.board.detail_layout_jsonb = layout;
    });
    mocks.setGroupLayout.mockImplementation(async (_ctx, groupId: string, layout: Array<Record<string, unknown>>) => {
      const group = mocks.detail.groups.find((candidate) => candidate.id === groupId);
      if (group) group.detail_layout_jsonb = layout;
    });
    mocks.detail.board.source = null;
    mocks.detail.columns = [{ id: "col-1", key: "detail_법인공동인증서", label: "법인공동인증서", type: "text" }];
    mocks.detail.board.detail_layout_jsonb = [
      { key: "detail_법인공동인증서", source: "column", label: "법인공동인증서", type: "text" },
    ];
    mocks.detail.groups[0].detail_layout_jsonb = null;
  });

  it("배치를 상세로 되돌리고 컬럼은 휴지통으로 보낸다 — 값은 지우지 않는다", async () => {
    await demoteDetailFieldAction(form({ boardId: "board-a", fieldKey: "detail_법인공동인증서" }));

    expect(mocks.setBoardLayout).toHaveBeenCalledWith(expect.anything(), "board-a", [
      expect.objectContaining({ key: "detail_법인공동인증서", source: "detail" }),
    ]);
    // deleteColumn 은 archive 다(restoreColumn 이 짝으로 있다). 값과 설정이 남는다.
    expect(mocks.deleteColumn).toHaveBeenCalledWith(expect.anything(), "board-a", "col-1");
  });

  it("올리기 → 내리기 왕복 뒤 배치가 원래대로 돌아온다", async () => {
    mocks.detail.columns = [];
    mocks.detail.board.detail_layout_jsonb = [
      { key: "detail_법인공동인증서", source: "detail", label: "법인공동인증서", type: "text" },
    ];

    await promoteDetailFieldAction(form({ boardId: "board-a", fieldKey: "detail_법인공동인증서" }));
    expect(mocks.detail.board.detail_layout_jsonb).toEqual([
      expect.objectContaining({ source: "column" }),
    ]);

    mocks.detail.columns = [{ id: "col-1", key: "detail_법인공동인증서", label: "법인공동인증서", type: "text" }];
    await demoteDetailFieldAction(form({ boardId: "board-a", fieldKey: "detail_법인공동인증서" }));
    expect(mocks.detail.board.detail_layout_jsonb).toEqual([
      expect.objectContaining({ source: "detail" }),
    ]);
  });

  it("★ 원래부터 표 컬럼이던 칸은 내리지 않는다 — 되돌리기가 아니라 구조 축소다", async () => {
    mocks.detail.columns = [{ id: "col-owner", key: "owner", label: "담당자", type: "person" }];
    mocks.detail.board.detail_layout_jsonb = [
      { key: "owner", source: "column", label: "담당자", type: "person" },
    ];

    await demoteDetailFieldAction(form({ boardId: "board-a", fieldKey: "owner" }));

    expect(mocks.setBoardLayout).not.toHaveBeenCalled();
    expect(mocks.deleteColumn).not.toHaveBeenCalled();
  });

  it("이미 상세인 칸을 또 내려도 아무것도 바꾸지 않는다", async () => {
    mocks.detail.board.detail_layout_jsonb = [
      { key: "detail_법인공동인증서", source: "detail", label: "법인공동인증서", type: "text" },
    ];

    await demoteDetailFieldAction(form({ boardId: "board-a", fieldKey: "detail_법인공동인증서" }));

    expect(mocks.setBoardLayout).not.toHaveBeenCalled();
    expect(mocks.deleteColumn).not.toHaveBeenCalled();
  });
});
