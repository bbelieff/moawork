import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_ACTION_FLASH_COOKIE, decodeBoardActionFlash } from "@/lib/boards/boardActionFlash";

/**
 * #845 7단계 — 나눠 보기의 값 바꾸기(묶음 사이 끌기)와 묶음 ＋ 미리 채우기는 서버가 다시 막는다.
 *   · 항목 수정 권한이 없으면 거절(화면이 끌기를 감춰도 서버가 막는다)
 *   · 고칠 수 없는 칸 · ✉ 발송 칸 · 신규리드 정본 · 배정 담당 · 넘기기 값 · 회사 밖 사람은 거절
 *   · 통과하면 칸 편집과 같은 setCells 경로로 쓴다
 */

const h = vi.hoisted(() => ({
  guard: { kind: "allowed", reason: undefined as string | undefined },
  source: "user" as string,
  activeMembers: ["u1", "u2"] as string[],
  setCells: vi.fn<(...args: unknown[]) => Promise<{ errors: { key: string; label: string; message: string }[]; notices?: unknown[] }>>(async () => ({ errors: [] })),
  createItem: vi.fn<(...args: unknown[]) => Promise<{ id: string }>>(async () => ({ id: "new-1" })),
  notify: vi.fn(async () => 1),
  cookieSet: vi.fn(),
}));

const columns = [
  {
    key: "institution", label: "진행기관", type: "select", source: "act", is_readonly: false,
    options_jsonb: { options: [{ id: "kodit", label: "신용보증기금" }, { id: "kibo", label: "기술보증기금" }] },
    move_rule_jsonb: null,
  },
  {
    key: "stage", label: "단계", type: "status", source: "act", is_readonly: false,
    options_jsonb: { options: [{ id: "review", label: "심사 중" }] },
    move_rule_jsonb: { review: "g-review" },
  },
  { key: "biz", label: "사업자유형", type: "select", source: "lk", is_readonly: true, options_jsonb: null, move_rule_jsonb: null },
  { key: "sms", label: "문자", type: "status", source: "msg", is_readonly: false, options_jsonb: null, move_rule_jsonb: null },
  { key: "owner", label: "담당자", type: "person", source: "act", is_readonly: false, options_jsonb: null, move_rule_jsonb: null },
  { key: "contact_move", label: "컨택 이동", type: "status", source: "act", is_readonly: false, options_jsonb: null, move_rule_jsonb: null },
  { key: "memo", label: "메모", type: "text", source: "in", is_readonly: false, options_jsonb: null, move_rule_jsonb: null },
];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: h.cookieSet }) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ org: { id: "org-1" }, user: { id: "u1" }, role: "member", scope: "own" }),
  applyAs: (ctx: unknown) => ctx,
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: async () => h.guard }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: async () => ({ ok: true }) }));
vi.mock("@/lib/notify/board-actions", () => ({ notifyBoardItemMoved: h.notify }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    client: {
      from: () => {
        const query = {
          ids: [] as string[],
          select() { return query; },
          eq() { return query; },
          in(_column: string, ids: string[]) {
            query.ids = ids;
            return Promise.resolve({ data: ids.filter((id) => h.activeMembers.includes(id)).map((user_id) => ({ user_id })), error: null });
          },
        };
        return query;
      },
    },
    repo: {},
    service: {
      setCells: h.setCells,
      createItem: h.createItem,
      getBoardDetail: async () => ({
        board: { id: "board-1", source: h.source },
        columns,
        groups: [{ id: "g-first" }, { id: "g-review" }],
      }),
    },
  }),
}));

import { addItemAction, setGroupValueAction } from "./actions";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}
const move = (columnKey: string, value: unknown) =>
  setGroupValueAction(form({ boardId: "board-1", itemId: "item-1", columnKey, value: JSON.stringify(value) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.guard.kind = "allowed";
  h.guard.reason = undefined;
  h.source = "user";
  h.activeMembers = ["u1", "u2"];
  h.setCells.mockImplementation(async () => ({ errors: [] }));
});

describe("setGroupValueAction — 묶음 사이 끌기", () => {
  it("통과하면 칸 편집과 같은 setCells 로 그 칸만 쓴다", async () => {
    await expect(move("institution", "kibo")).resolves.toEqual({ ok: true });
    expect(h.setCells).toHaveBeenCalledWith(expect.anything(), "board-1", "item-1", { institution: "kibo" });
  });

  it("「(없음)」 으로 옮기면 칸을 비운다", async () => {
    await expect(move("institution", null)).resolves.toEqual({ ok: true });
    expect(h.setCells).toHaveBeenCalledWith(expect.anything(), "board-1", "item-1", { institution: null });
  });

  it("항목 수정 권한이 없으면 쓰지 않고 까닭을 돌려준다(던지지 않는다)", async () => {
    h.guard.kind = "denied";
    h.guard.reason = "permission";
    await expect(move("institution", "kibo")).resolves.toEqual({ ok: false, message: "이 업무를 실행할 권한이 없어요." });
    expect(h.setCells).not.toHaveBeenCalled();
  });

  it.each([
    ["biz", "x", "고칠 수 없는 칸이에요."],
    ["sms", "x", "문자가 나가는 칸은 칸에서 바꿔요."],
    ["memo", "x", "이 칸으로는 나눌 수 없어요."],
    ["contact_move", "컨택 이동", "이 값은 칸에서 바꿔요."],
  ])("%s 칸은 이 길로 쓰지 않는다", async (columnKey, value, message) => {
    await expect(move(columnKey, value)).resolves.toEqual({ ok: false, message });
    expect(h.setCells).not.toHaveBeenCalled();
  });

  it("배정으로 관리하는 담당(리드컨택·실무)과 신규리드 정본은 칸에서만 바꾼다", async () => {
    h.source = CONTRACT_WORK_TAB_SOURCE;
    await expect(move("owner", "u2")).resolves.toEqual({ ok: false, message: "담당은 담당 칸에서 바꿔요." });
    h.source = NEW_LEAD_TAB_SOURCE;
    await expect(move("institution", "kibo")).resolves.toEqual({ ok: false, message: "이 탭에서는 칸에서 바꿔요." });
    expect(h.setCells).not.toHaveBeenCalled();
  });

  it("회사 밖 사람으로는 옮기지 않는다", async () => {
    await expect(move("owner", "outsider")).resolves.toEqual({ ok: false, message: "이 회사에 속한 사람만 선택할 수 있어요." });
    expect(h.setCells).not.toHaveBeenCalled();
    await expect(move("owner", "u2")).resolves.toEqual({ ok: true });
  });

  it("setCells 가 그 칸을 거절하면(예: 행을 옮길 권한) 실패로 돌려준다", async () => {
    h.setCells.mockImplementationOnce(async () => ({ errors: [{ key: "stage", label: "단계", message: "전체 행을 볼 수 있는 사용자만 행을 옮길 수 있어요." }] }));
    await expect(move("stage", "review")).resolves.toEqual({ ok: false, message: "전체 행을 볼 수 있는 사용자만 행을 옮길 수 있어요." });
  });
});

describe("addItemAction — 묶음 ＋ 미리 채우기", () => {
  const add = (extra: Record<string, string>) =>
    addItemAction(form({ boardId: "board-1", groupId: "g-first", title: "새 회사", ...extra }));

  it("묶음 값을 만들 때 같이 넣는다(첫 보드)", async () => {
    await add({ prefillKey: "institution", prefillValue: JSON.stringify("kodit") });
    expect(h.createItem).toHaveBeenCalledWith(expect.anything(), "board-1", expect.objectContaining({
      title: "새 회사", group_id: "g-first", values: { institution: "kodit" },
    }));
  });

  it("행을 옮기는 단계 값이면 그 단계의 보드에 만든다", async () => {
    await add({ prefillKey: "stage", prefillValue: JSON.stringify("review") });
    expect(h.createItem).toHaveBeenCalledWith(expect.anything(), "board-1", expect.objectContaining({
      group_id: "g-review", values: { stage: "review" },
    }));
  });

  it("미리 채울 수 없는 칸이면 만들지 않고 보드 안에서 까닭을 말한다", async () => {
    await add({ prefillKey: "biz", prefillValue: JSON.stringify("x") });
    expect(h.createItem).not.toHaveBeenCalled();
    const call = [...h.cookieSet.mock.calls].reverse().find(([name]) => name === BOARD_ACTION_FLASH_COOKIE);
    expect(decodeBoardActionFlash(call?.[1] as string)?.message).toBe("고칠 수 없는 칸이에요.");
  });

  it("미리 채우기가 없으면 예전과 같다", async () => {
    await add({});
    expect(h.createItem).toHaveBeenCalledWith(expect.anything(), "board-1", { title: "새 회사", group_id: "g-first" });
  });
});
