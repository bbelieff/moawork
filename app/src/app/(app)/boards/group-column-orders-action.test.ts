// 2026-10-08 — 맨 위 제목행에서 컬럼을 옮기면 모든 그룹 배치를 한 번에 저장한다(setGroupColumnOrdersAction).
// 지키는 성질: 권한이 없거나, 그룹 키가 하나라도 이 보드에 없거나, 같은 키가 두 번 오면 «아무것도» 쓰지 않는다
// (앞 그룹만 저장되면 새로고침 뒤 그룹마다 배치가 갈라진다). 이 보드에 없는 컬럼 key 는 걸러진다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  setGroupColumnOrder: vi.fn(async () => {}),
  detail: {
    board: { id: "board-a", org_id: "org-a" },
    columns: [{ key: "kind" }, { key: "rep_name" }],
    groups: [{ id: "group-a" }, { id: "group-b" }],
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
    repo: { setGroupColumnOrder: mocks.setGroupColumnOrder },
  }),
}));

import { setGroupColumnOrdersAction } from "./actions";

function form(entries: unknown): FormData {
  const data = new FormData();
  data.set("boardId", "board-a");
  data.set("entries", JSON.stringify(entries));
  return data;
}

describe("setGroupColumnOrdersAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ kind: "allowed" });
  });

  it("모든 그룹 배치를 저장하고 이 보드에 없는 컬럼 key 는 거른다", async () => {
    await setGroupColumnOrdersAction(form([
      { groupKey: "group-a", order: ["rep_name", "kind", "ghost"] },
      { groupKey: "__ungrouped__", order: ["rep_name", "kind"] },
    ]));
    expect(mocks.guard).toHaveBeenCalledWith("org-a", "structure.column_manage");
    expect(mocks.setGroupColumnOrder).toHaveBeenCalledTimes(2);
    expect(mocks.setGroupColumnOrder).toHaveBeenNthCalledWith(1, expect.anything(), "board-a", "group-a", ["rep_name", "kind"]);
    expect(mocks.setGroupColumnOrder).toHaveBeenNthCalledWith(2, expect.anything(), "board-a", "__ungrouped__", ["rep_name", "kind"]);
  });

  it("그룹 키가 하나라도 이 보드에 없으면 아무것도 쓰지 않는다", async () => {
    await setGroupColumnOrdersAction(form([
      { groupKey: "group-a", order: ["rep_name", "kind"] },
      { groupKey: "consult-step:1", order: ["rep_name", "kind"] },
    ]));
    expect(mocks.setGroupColumnOrder).not.toHaveBeenCalled();
  });

  it("같은 그룹 키가 두 번 오면 아무것도 쓰지 않는다", async () => {
    await setGroupColumnOrdersAction(form([
      { groupKey: "group-a", order: ["rep_name", "kind"] },
      { groupKey: "group-a", order: ["kind", "rep_name"] },
    ]));
    expect(mocks.setGroupColumnOrder).not.toHaveBeenCalled();
  });

  it("권한이 없으면 아무것도 쓰지 않는다", async () => {
    mocks.guard.mockResolvedValue({ kind: "denied", reason: "permission" });
    await setGroupColumnOrdersAction(form([{ groupKey: "group-a", order: ["rep_name", "kind"] }]));
    expect(mocks.setGroupColumnOrder).not.toHaveBeenCalled();
  });

  it("형식이 틀리면 아무것도 쓰지 않는다", async () => {
    await setGroupColumnOrdersAction(form({ groupKey: "group-a" }));
    await setGroupColumnOrdersAction(form([{ groupKey: "group-a", order: [1, 2] }]));
    expect(mocks.setGroupColumnOrder).not.toHaveBeenCalled();
  });
});
