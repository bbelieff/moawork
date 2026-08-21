/**
 * 그룹 프리셋 consumer 의 실행형 증명 (BBE-174).
 *
 * 말로 «권한을 지켰다»·«값을 안 지웠다» 는 근거가 아니다(AGENTS.md §5). 여기서 확인하는 것:
 *   ① member 는 저장도 공용 적용도 못 한다 — 그리고 **막힌 뒤 아무것도 실행되지 않는다**
 *   ② 같은 요청을 두 번 보내도 프리셋이 하나만 생긴다
 *   ③ 적용은 컬럼을 지우지도 고치지도 않는다 (deleteColumn·updateColumn 호출 0)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  getBoardDetail: vi.fn(),
  addColumn: vi.fn(),
  deleteColumn: vi.fn(),
  updateColumn: vi.fn(),
  presetGet: vi.fn(),
  presetCreate: vi.fn(),
  presetFindBySource: vi.fn(),
  presetList: vi.fn(),
  listSectionPresetBoards: vi.fn(async () => []),
  setGroupColumnOrder: vi.fn(),
  getBoardColumnOrder: vi.fn(() => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "user-a" }, role: "member", scope: "assigned" })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: vi.fn(async () => ({
    client: {},
    repo: { listSectionPresetBoards: mocks.listSectionPresetBoards },
    service: {
      getBoardDetail: mocks.getBoardDetail,
      addColumn: mocks.addColumn,
      deleteColumn: mocks.deleteColumn,
      updateColumn: mocks.updateColumn,
    },
  })),
}));
vi.mock("@/lib/presets/section-presets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/presets/section-presets")>()),
  SectionPresetRepo: class {
    get = mocks.presetGet;
    create = mocks.presetCreate;
    findBySource = mocks.presetFindBySource;
    list = mocks.presetList;
  },
}));
vi.mock("./groupLayout", () => ({
  setGroupColumnOrder: mocks.setGroupColumnOrder,
  getBoardColumnOrder: mocks.getBoardColumnOrder,
}));

import {
  applyGroupPresetAction,
  loadGroupPresetLibraryAction,
  resetGroupPresetAction,
  saveGroupPresetAction,
} from "./preset-actions";
import { INITIAL_GROUP_PRESET_STATE } from "./group-preset-state";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const SAVE = { boardId: "board-a", groupKey: "group-a", requestId: "req-1", name: "신규리드 관리-1차 부재" };
const APPLY = { boardId: "board-a", groupKey: "group-a", presetId: "preset-a" };

describe("BBE-223 그룹 프리셋 라이브러리 지연 조회", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allow();
    mocks.getBoardDetail.mockResolvedValue({ columns: [], groups: [] });
    mocks.presetList.mockResolvedValue([{ id: "preset-a", name: "P", columns: [], groups: [] }]);
  });

  it("접근 가능한 보드를 먼저 확인한 뒤 조직 범위 프리셋을 한 번 읽는다", async () => {
    const state = await loadGroupPresetLibraryAction("board-a");

    expect(state.ok).toBe(true);
    expect(mocks.getBoardDetail).toHaveBeenCalledWith(expect.objectContaining({ org: { id: "org-a" } }), "board-a");
    expect(mocks.presetList).toHaveBeenCalledTimes(1);
    expect(state.presets).toHaveLength(1);
  });

  it("권한이 없으면 보드와 라이브러리를 전혀 읽지 않는다", async () => {
    allow("structure.preset_edit");
    const state = await loadGroupPresetLibraryAction("board-a");

    expect(state.ok).toBe(false);
    expect(state.presets).toEqual([]);
    expect(mocks.getBoardDetail).not.toHaveBeenCalled();
    expect(mocks.presetList).not.toHaveBeenCalled();
  });

  it("다른 조직 보드처럼 보드 접근 확인이 실패하면 목록을 읽지 않고 원문을 숨긴다", async () => {
    mocks.getBoardDetail.mockRejectedValue(new Error("row-level security board-b"));
    const state = await loadGroupPresetLibraryAction("board-b");

    expect(state.ok).toBe(false);
    expect(state.presets).toEqual([]);
    expect(state.message).not.toContain("row-level");
    expect(mocks.presetList).not.toHaveBeenCalled();
  });

  it("저장소 오류는 빈 목록과 일반 문구로 fail-closed 한다", async () => {
    mocks.presetList.mockRejectedValue(new Error("relation section_preset missing"));
    const state = await loadGroupPresetLibraryAction("board-a");

    expect(state.ok).toBe(false);
    expect(state.presets).toEqual([]);
    expect(state.message).toContain("잠시 후 다시 시도");
    expect(state.message).not.toContain("relation");
  });
});

/** 목업 신규리드에 있는 형태 — 이동규칙과 우측 고정 열이 붙은 실제에 가까운 컬럼. */
function column(key: string, patch: Record<string, unknown> = {}) {
  return {
    id: `col-${key}`, org_id: "org-a", board_id: "board-a", key, label: key,
    type: "text", source: "in", rightPinned: false, options_jsonb: null,
    sort_order: 0, width: null, move_rule_jsonb: null, is_readonly: false, ...patch,
  };
}

function presetColumn(key: string, patch: Record<string, unknown> = {}) {
  return {
    key, label: key, type: "text", source: "in", rightPinned: false,
    options: [], width: null, move_rule_jsonb: null, is_readonly: false, ...patch,
  };
}

function allow(...denied: string[]) {
  mocks.guard.mockImplementation(async (_org: string, key: string) =>
    denied.includes(key) ? { kind: "denied", reason: "permission" } : { kind: "allowed" },
  );
}

/**
 * 실제 `createColumn` 처럼 **만들어진 컬럼을 돌려준다.** 실행부가 이 반환값의 key 로 배치를
 * 세우므로, 여기서 undefined 를 돌려주면 테스트가 실제와 다른 계약을 검증하게 된다.
 */
function addColumnReturnsCreated() {
  mocks.addColumn.mockImplementation(async (_ctx: unknown, _boardId: string, input: { key: string }) =>
    column(input.key),
  );
}

describe("그룹 프리셋 액션 — 권한", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBoardColumnOrder.mockReturnValue({});
    mocks.presetFindBySource.mockResolvedValue(undefined);
    mocks.getBoardDetail.mockResolvedValue({ columns: [column("a")], groups: [{ id: "group-a", name: "1차 부재", color: null }] });
    mocks.presetGet.mockResolvedValue({ id: "preset-a", name: "P", columns: [presetColumn("a")], groups: [] });
  });

  it("member 는 저장이 거부되고 프리셋이 만들어지지 않는다", async () => {
    // 기본 권한표(perm/matrix.ts)에서 member 는 structure.preset_edit 이 false 다.
    allow("structure.preset_edit");

    const state = await saveGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(SAVE));

    expect(state.ok).toBe(false);
    expect(state.message).toContain("권한이 없습니다");
    expect(mocks.presetCreate).not.toHaveBeenCalled();
    // 권한을 보기 전에 보드를 읽지도 않는다.
    expect(mocks.getBoardDetail).not.toHaveBeenCalled();
  });

  it("member 는 공용 적용이 거부되고 컬럼이 추가되지 않는다", async () => {
    allow("structure.preset_edit", "structure.column_manage");

    const state = await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    expect(state.ok).toBe(false);
    expect(mocks.presetGet).not.toHaveBeenCalled();
    expect(mocks.addColumn).not.toHaveBeenCalled();
    expect(mocks.setGroupColumnOrder).not.toHaveBeenCalled();
  });

  it("프리셋 편집은 되지만 컬럼 권한이 없으면 적용을 막는다 — 둘 다 필요하다", async () => {
    allow("structure.column_manage");

    const state = await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    expect(state.ok).toBe(false);
    expect(mocks.guard.mock.calls.map((call) => call[1])).toEqual([
      "structure.preset_edit",
      "structure.column_manage",
    ]);
    expect(mocks.addColumn).not.toHaveBeenCalled();
  });

  it("되돌리기도 컬럼 권한을 요구한다 — 배치를 못 바꾸는 사람이 되돌릴 수는 없다", async () => {
    allow("structure.column_manage");

    const state = await resetGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form({ boardId: "board-a", groupKey: "group-a" }));

    expect(state.ok).toBe(false);
    expect(mocks.setGroupColumnOrder).not.toHaveBeenCalled();
  });

  it("권한 «없음» 과 «확인 불가» 는 다른 문장으로 알린다", async () => {
    mocks.guard.mockResolvedValue({ kind: "denied", reason: "unavailable" });

    const state = await saveGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(SAVE));

    expect(state.ok).toBe(false);
    expect(state.message).toContain("확인하지 못했습니다");
  });
});

describe("그룹 프리셋 액션 — replay 멱등성", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allow();
    mocks.getBoardColumnOrder.mockReturnValue({});
    mocks.getBoardDetail.mockResolvedValue({ columns: [column("a")], groups: [{ id: "group-a", name: "1차 부재", color: null }] });
  });

  it("같은 요청을 두 번 보내면 프리셋을 한 번만 만든다", async () => {
    // 1회차 — 같은 source 가 아직 없다.
    mocks.presetFindBySource.mockResolvedValueOnce(undefined);
    const first = await saveGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(SAVE));
    expect(first.ok).toBe(true);
    expect(mocks.presetCreate).toHaveBeenCalledTimes(1);

    // 2회차 — 1회차가 남긴 source 를 저장소가 돌려준다(재전송).
    mocks.presetFindBySource.mockResolvedValueOnce({ id: "preset-a", name: SAVE.name, columns: [], groups: [] });
    const second = await saveGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(SAVE));

    expect(second.ok).toBe(true);
    expect(second.message).toContain("이미 저장돼 있습니다");
    expect(mocks.presetCreate).toHaveBeenCalledTimes(1);
  });

  it("저장 source 는 요청 id 로 결정되고, 다른 요청은 다른 source 를 쓴다", async () => {
    mocks.presetFindBySource.mockResolvedValue(undefined);
    await saveGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(SAVE));
    await saveGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form({ ...SAVE, requestId: "req-2" }));

    const sources = mocks.presetCreate.mock.calls.map((call) => call[2]);
    expect(sources).toHaveLength(2);
    expect(sources[0]).not.toBe(sources[1]);
    for (const source of sources) expect(source).toMatch(/^user\.section-preset\//);
  });

  it("저장은 그 그룹의 해결된 컬럼 순서를 담는다 — 보드 기본 순서가 아니다", async () => {
    mocks.presetFindBySource.mockResolvedValue(undefined);
    mocks.getBoardDetail.mockResolvedValue({
      columns: [column("a"), column("b"), column("c")],
      groups: [{ id: "group-a", name: "1차 부재", color: null }],
    });
    mocks.getBoardColumnOrder.mockReturnValue({ "group-a": ["c", "a", "b"] });

    await saveGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(SAVE));

    const snapshot = mocks.presetCreate.mock.calls[0][1];
    expect(snapshot.columns.map((c: { key: string }) => c.key)).toEqual(["c", "a", "b"]);
    expect(snapshot.groups).toEqual([{ name: "1차 부재", color: null }]);
  });

  it("없는 그룹으로 저장을 시도하면 프리셋을 만들지 않는다", async () => {
    mocks.presetFindBySource.mockResolvedValue(undefined);

    const state = await saveGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form({ ...SAVE, groupKey: "__ungrouped__" }));

    expect(state.ok).toBe(false);
    expect(mocks.presetCreate).not.toHaveBeenCalled();
  });
});

describe("그룹 프리셋 액션 — 값 유실 0", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allow();
    mocks.getBoardColumnOrder.mockReturnValue({});
    addColumnReturnsCreated();
  });

  it("적용은 컬럼을 지우지도 고치지도 않는다 — 더하기와 재배치뿐이다", async () => {
    const existing = [
      column("consult_status", { type: "select", options_jsonb: { options: [{ id: "a", label: "A" }] }, move_rule_jsonb: { a: "g1" } }),
      column("private_memo"),
    ];
    mocks.getBoardDetail.mockResolvedValue({ columns: existing, groups: [] });
    mocks.presetGet.mockResolvedValue({
      id: "preset-a",
      name: "표준 상담",
      // 같은 key 인데 타입이 다르다 — 덮어쓰면 그 key 에 쌓인 값이 형식을 잃는다.
      columns: [presetColumn("consult_status", { type: "text" }), presetColumn("callback_at", { type: "datetime" })],
      groups: [],
    });

    const state = await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    expect(state.ok).toBe(true);
    expect(mocks.deleteColumn).not.toHaveBeenCalled();
    expect(mocks.updateColumn).not.toHaveBeenCalled();
    // 새 컬럼만 만든다. 이미 있는 key 는 손대지 않는다.
    expect(mocks.addColumn).toHaveBeenCalledTimes(1);
    expect(mocks.addColumn.mock.calls[0][2]).toMatchObject({ key: "callback_at", type: "datetime" });
  });

  it("프리셋에 없는 기존 컬럼도 배치에 남는다 — 구조가 줄지 않는다", async () => {
    mocks.getBoardDetail.mockResolvedValue({
      columns: [column("keep_me"), column("shared")],
      groups: [],
    });
    mocks.presetGet.mockResolvedValue({ id: "preset-a", name: "P", columns: [presetColumn("shared")], groups: [] });

    await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    const [, , , order] = mocks.setGroupColumnOrder.mock.calls[0];
    expect(order).toContain("keep_me");
    expect(order).toContain("shared");
    expect(order).toHaveLength(2);
  });

  it("컬럼 메타데이터 7종을 그대로 실어 추가한다", async () => {
    mocks.getBoardDetail.mockResolvedValue({ columns: [], groups: [] });
    mocks.presetGet.mockResolvedValue({
      id: "preset-a",
      name: "P",
      columns: [presetColumn("contact_move", {
        type: "status", source: "act", rightPinned: true, width: 120,
        options: [{ id: "wait", label: "컨택 대기" }],
        move_rule_jsonb: { wait: "group-x" },
        is_readonly: true,
      })],
      groups: [],
    });

    await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    expect(mocks.addColumn.mock.calls[0][2]).toEqual({
      key: "contact_move", label: "contact_move", type: "status", source: "act",
      rightPinned: true, options: [{ id: "wait", label: "컨택 대기" }], width: 120,
      moveRule: { wait: "group-x" }, readOnly: true,
    });
  });

  /*
   * 원문 유출은 «컬럼 추가» 말고도 여러 경로에서 난다 — getBoardDetail·presets.get/create 는
   * 저장소가 던진 것을 그대로 올려보낸다. 아래 세 경로를 각각 건드려, failure() 가 그 전부를
   * 일반 문구로 수렴시키는지 본다. (컬럼 추가 경로는 루프가 먼저 잡으므로 여기 포함하지 않는다.)
   */
  const RAW = 'duplicate key value violates unique constraint "board_columns_board_id_key_key"';

  it("보드 조회가 던진 저장소 원문을 사용자에게 보여주지 않는다", async () => {
    mocks.getBoardDetail.mockRejectedValue(new Error(RAW));

    const state = await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    expect(state.ok).toBe(false);
    expect(state.message).not.toContain("constraint");
    expect(state.message).not.toContain("board_columns");
    expect(state.message).toContain("잠시 후 다시 시도");
  });

  it("프리셋 조회가 던진 원문도 마찬가지다", async () => {
    mocks.presetGet.mockRejectedValue(new Error(RAW));

    const state = await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    expect(state.ok).toBe(false);
    expect(state.message).not.toContain("constraint");
  });

  it("저장(create)이 던진 원문도 마찬가지다", async () => {
    mocks.presetFindBySource.mockResolvedValue(undefined);
    mocks.getBoardDetail.mockResolvedValue({ columns: [], groups: [{ id: "group-a", name: "g", color: null }] });
    mocks.presetCreate.mockRejectedValue(new Error(RAW));

    const state = await saveGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(SAVE));

    expect(state.ok).toBe(false);
    expect(state.message).not.toContain("constraint");
    expect(state.message).toContain("잠시 후 다시 시도");
  });

  it("내가 쓴 문장(권한 거부)은 그대로 보여준다 — 전부 뭉개지 않는다", async () => {
    allow("structure.preset_edit");

    const state = await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    expect(state.ok).toBe(false);
    expect(state.message).toContain("권한이 없습니다");
  });

  it("부분 적용이 남으면 그 사실을 숨기지 않고 «이어서 진행» 을 안내한다", async () => {
    mocks.getBoardDetail.mockResolvedValue({ columns: [], groups: [] });
    mocks.presetGet.mockResolvedValue({
      id: "preset-a",
      name: "P",
      columns: [presetColumn("a"), presetColumn("b"), presetColumn("c")],
      groups: [],
    });
    // 첫 둘은 만들어지고 셋째에서 실패한다.
    mocks.addColumn
      .mockResolvedValueOnce(column("a"))
      .mockResolvedValueOnce(column("b"))
      .mockRejectedValueOnce(new Error("boom"));

    const state = await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    expect(state.ok).toBe(false);
    expect(state.message).toContain("2개는 이미 추가");
    expect(state.message).toContain("다시");
    // 배치는 저장되지 않는다 — 절반 적용된 순서를 정본으로 굳히지 않는다.
    expect(mocks.setGroupColumnOrder).not.toHaveBeenCalled();
    // 되돌리려고 컬럼을 지우지 않는다(그게 값 파손 경로다).
    expect(mocks.deleteColumn).not.toHaveBeenCalled();
  });

  it("아무것도 못 만들고 실패하면 «바뀐 것 없음» 으로 말한다", async () => {
    mocks.getBoardDetail.mockResolvedValue({ columns: [], groups: [] });
    mocks.presetGet.mockResolvedValue({ id: "preset-a", name: "P", columns: [presetColumn("a")], groups: [] });
    mocks.addColumn.mockRejectedValue(new Error("boom"));

    const state = await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    expect(state.ok).toBe(false);
    expect(state.message).toContain("바뀐 것은 없습니다");
  });

  it("되돌리기는 배치만 비우고 컬럼은 건드리지 않는다", async () => {
    mocks.getBoardDetail.mockResolvedValue({ columns: [column("a")], groups: [] });

    const state = await resetGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form({ boardId: "board-a", groupKey: "group-a" }));

    expect(state.ok).toBe(true);
    expect(mocks.setGroupColumnOrder).toHaveBeenCalledWith("org-a", "board-a", "group-a", []);
    expect(mocks.deleteColumn).not.toHaveBeenCalled();
    expect(mocks.addColumn).not.toHaveBeenCalled();
  });

  it("배치에는 «프리셋이 말한 key» 가 아니라 실제로 만들어진 key 가 들어간다", async () => {
    /*
     * createColumn 은 key 가 이미 있으면 `_2` 를 붙여 **다른 key** 로 만든다. 프리셋이 말한
     * key 를 그대로 배치에 박으면 보드에 없는 key 가 남아 그 컬럼이 배치에서 빠진다.
     * 실행부는 addColumn 이 돌려준 key 를 쓴다.
     */
    mocks.getBoardDetail.mockResolvedValue({ columns: [column("a")], groups: [] });
    mocks.addColumn.mockResolvedValue(column("b_2"));
    mocks.presetGet.mockResolvedValue({ id: "preset-a", name: "P", columns: [presetColumn("b")], groups: [] });

    await applyGroupPresetAction(INITIAL_GROUP_PRESET_STATE, form(APPLY));

    const [, , , order] = mocks.setGroupColumnOrder.mock.calls[0];
    expect(order).toEqual(["b_2", "a"]);
    expect(order).not.toContain("b");
  });
});
