import { beforeEach, describe, expect, it, vi } from "vitest";

// #849 — 탭 만들기의 사이드바 자리, 탭 삭제 = 휴지통 뒤 이동.

const mocks = vi.hoisted(() => ({
  role: "owner",
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
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "user-a" }, role: mocks.role })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: vi.fn(async () => ({ kind: "allowed" })) }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    service: { createBoard: mocks.createBoard, deleteBoard: mocks.deleteBoard },
  }),
}));

import { createBoardAction, deleteBoardAction } from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function redirectedTo(run: Promise<void>): Promise<string> {
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
