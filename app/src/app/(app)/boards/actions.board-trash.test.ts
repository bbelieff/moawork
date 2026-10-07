import { beforeEach, describe, expect, it, vi } from "vitest";

// #849 — 탭 만들기의 사이드바 자리, 사이드바 「새 탭」 의 실패 처리, 탭 삭제 = 휴지통 뒤 이동.

const mocks = vi.hoisted(() => ({
  role: "owner",
  permission: { kind: "allowed" } as { kind: string; reason?: string },
  session: vi.fn(),
  createBoard: vi.fn(),
  deleteBoard: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: vi.fn(async () => mocks.permission) }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    service: { createBoard: mocks.createBoard, deleteBoard: mocks.deleteBoard },
  }),
}));

import { createBoardAction, createTabFromSidebarAction, deleteBoardAction } from "./actions";
import {
  CREATE_TAB_FAILED_MESSAGE,
  CREATE_TAB_REPLAY_MESSAGE,
  INITIAL_CREATE_TAB_ACTION_STATE,
} from "./create-tab-action-state";

beforeEach(() => {
  mocks.permission = { kind: "allowed" };
  mocks.session.mockImplementation(async () => ({ org: { id: "org-a" }, user: { id: "user-a" }, role: mocks.role }));
});

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function redirectedTo(run: Promise<unknown>): Promise<string> {
  const error = await run.then(() => null, (caught: unknown) => caught as { digest?: string });
  return (error?.digest ?? "").split(";")[2] ?? "";
}

describe("createBoardAction · 사이드바 자리", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBoard.mockResolvedValue({ board: { id: "board-new" } });
  });

  it.each([
    ["before-contract", "before-contract"],
    ["after-contract", "after-contract"],
    ["", "after-contract"],
    ["sidebar-top", "after-contract"],
  ])("nav_section=%j → %s", async (sent, stored) => {
    const fields: Record<string, string> = { name: "새 탭", requestId: "11111111-1111-4111-8111-111111111111" };
    if (sent) fields.nav_section = sent;
    expect(await redirectedTo(createBoardAction(form(fields)))).toBe("/boards/board-new");
    expect(mocks.createBoard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "새 탭", nav_section: stored }),
      "11111111-1111-4111-8111-111111111111",
    );
  });
});

describe("createTabFromSidebarAction · 사이드바 「새 탭」", () => {
  const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createBoard.mockResolvedValue({ board: { id: "board-new" } });
  });

  it("성공하면 자리·요청 ID 로 만들고 새 탭으로 이동한다(createBoardAction 과 같은 본문)", async () => {
    const run = createTabFromSidebarAction(
      INITIAL_CREATE_TAB_ACTION_STATE,
      form({ name: "영업 파이프라인", nav_section: "before-contract", requestId: REQUEST_ID }),
    );
    expect(await redirectedTo(run)).toBe("/boards/board-new");
    expect(mocks.createBoard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "영업 파이프라인", nav_section: "before-contract" }),
      REQUEST_ID,
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards");
  });

  it("★ 권한이 없으면 던지지 않고 사람 말을 돌려준다 — 셸 전체가 오류 화면으로 덮이지 않게", async () => {
    mocks.permission = { kind: "denied", reason: "permission" };
    await expect(createTabFromSidebarAction(INITIAL_CREATE_TAB_ACTION_STATE, form({ name: "새 탭", requestId: REQUEST_ID })))
      .resolves.toEqual({ error: "이 업무를 실행할 권한이 없어요." });
    expect(mocks.createBoard).not.toHaveBeenCalled();
  });

  it("이름이 비면 입력 확인 문장을 돌려준다", async () => {
    const state = await createTabFromSidebarAction(INITIAL_CREATE_TAB_ACTION_STATE, form({ name: "   " }));
    expect(state.error).toMatch(/^입력을 확인해 주세요 — /u);
    expect(mocks.createBoard).not.toHaveBeenCalled();
  });

  it("★ 같은 요청 ID 에 다른 내용(169 request_replay_conflict)이면 창을 다시 열라고 안내한다", async () => {
    mocks.createBoard.mockRejectedValue(new Error("request_replay_conflict"));
    await expect(createTabFromSidebarAction(INITIAL_CREATE_TAB_ACTION_STATE, form({ name: "다른 이름", requestId: REQUEST_ID })))
      .resolves.toEqual({ error: CREATE_TAB_REPLAY_MESSAGE });
  });

  it("★ DB 원문은 보여주지 않는다 — 일반 실패 문장", async () => {
    mocks.createBoard.mockRejectedValue(new Error('relation "boards" violates row-level security policy'));
    await expect(createTabFromSidebarAction(INITIAL_CREATE_TAB_ACTION_STATE, form({ name: "새 탭", requestId: REQUEST_ID })))
      .resolves.toEqual({ error: CREATE_TAB_FAILED_MESSAGE });
  });

  it("★ 본문 안의 redirect(로그인 이동 등)는 삼키지 않고 되던진다", async () => {
    mocks.session.mockImplementation(async () => {
      const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
      error.digest = "NEXT_REDIRECT;replace;/login;307;";
      throw error;
    });
    expect(await redirectedTo(createTabFromSidebarAction(INITIAL_CREATE_TAB_ACTION_STATE, form({ name: "새 탭" }))))
      .toBe("/login");
  });
});

describe("deleteBoardAction · 휴지통으로", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "owner";
    mocks.deleteBoard.mockResolvedValue(undefined);
  });

  it("대표는 탭 관리 › 휴지통으로 가서 방금 지운 탭 안내를 본다", async () => {
    expect(await redirectedTo(deleteBoardAction(form({ boardId: "board-a" }))))
      .toBe("/settings/workspace-builder?section=tabs&trashed=board-a");
    expect(mocks.deleteBoard).toHaveBeenCalledWith(expect.anything(), "board-a");
    expect(mocks.revalidate).toHaveBeenCalledWith("/settings/workspace-builder");
  });

  it("휴지통 화면에 못 들어가는 역할은 탭 목록으로 돌아간다", async () => {
    mocks.role = "admin";
    expect(await redirectedTo(deleteBoardAction(form({ boardId: "board-a" })))).toBe("/boards");
  });
});
