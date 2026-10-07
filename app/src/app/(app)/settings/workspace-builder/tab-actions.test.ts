import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  risky: vi.fn(),
  restoreBoard: vi.fn(),
  purgeBoard: vi.fn(),
  clearDefaultTabDismissal: vi.fn(),
  ensureDefaultTab: vi.fn(),
  revalidate: vi.fn(),
  order: [] as string[],
  repo: { kind: "request-repo" },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
// Next 의 redirect 처럼 «던진다» — 액션이 catch 로 삼키면 테스트가 잡는다.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "user-a" }, role: "owner" })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: mocks.risky }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    client: null,
    repo: mocks.repo,
    service: {
      restoreBoard: (...args: unknown[]) => { mocks.order.push("restore"); return mocks.restoreBoard(...args); },
      purgeBoard: (...args: unknown[]) => { mocks.order.push("purge"); return mocks.purgeBoard(...args); },
      clearDefaultTabDismissal: (...args: unknown[]) => { mocks.order.push("clear"); return mocks.clearDefaultTabDismissal(...args); },
    },
  }),
}));
vi.mock("@/lib/default-tabs/install", () => ({
  DEFAULT_TABS: [
    { key: "new", source: "core.default-tab/new-lead", name: "신규리드 관리" },
    { key: "notice", source: "core.default-tab/notice", name: "공지" },
  ],
  ensureDefaultTab: (...args: unknown[]) => { mocks.order.push("ensure"); return mocks.ensureDefaultTab(...args); },
}));

import { NotFoundError } from "@/lib/boards";
import { DefaultTabAlreadyInstalledError } from "@/lib/boards/trash-errors";
import { purgeBoardAction, reinstallDefaultTabAction, restoreBoardAction } from "./tab-actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** 액션이 보낸 곳 — redirect 는 던지므로 거기서 주소를 꺼낸다. */
async function landing(run: Promise<void>): Promise<URL> {
  const error = await run.then(() => null, (caught: unknown) => caught as { digest?: string });
  const digest = error?.digest ?? "";
  expect(digest, "액션이 결과 화면으로 돌려보내지 않았다").toMatch(/^NEXT_REDIRECT;/);
  return new URL(digest.split(";")[2], "https://app.local");
}

describe("탭 휴지통 서버 액션", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.guard.mockImplementation(async (_org: string, scope: string) => {
      mocks.order.push(`guard:${scope}`);
      return { kind: "allowed" };
    });
    mocks.risky.mockImplementation(async () => {
      mocks.order.push("audit");
      return { ok: true };
    });
    mocks.restoreBoard.mockResolvedValue({ id: "board-a" });
    mocks.purgeBoard.mockResolvedValue(2);
    mocks.clearDefaultTabDismissal.mockResolvedValue(true);
    mocks.ensureDefaultTab.mockResolvedValue({ boardId: "board-new" });
  });

  it("복구는 삭제 권한 확인과 위험 작업 기록 뒤에만 실행하고 결과 화면으로 돌아간다", async () => {
    const url = await landing(restoreBoardAction(form({ boardId: "board-a" })));
    expect(mocks.order).toEqual(["guard:danger.bulk_edit_delete", "audit", "restore"]);
    expect(mocks.risky).toHaveBeenCalledWith("org-a", "danger.bulk_edit_delete", { operation: "board_trash.restore", boardId: "board-a" });
    expect(mocks.restoreBoard).toHaveBeenCalledWith(expect.objectContaining({ org: { id: "org-a" } }), "board-a");
    expect(url.pathname).toBe("/settings/workspace-builder");
    expect(Object.fromEntries(url.searchParams)).toEqual({ section: "tabs", restored: "board-a" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/settings/workspace-builder");
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-a");
  });

  it("권한이 없거나 기록에 실패하면 복구하지 않고 이유를 돌려준다", async () => {
    mocks.guard.mockResolvedValueOnce({ kind: "denied", reason: "permission" });
    expect((await landing(restoreBoardAction(form({ boardId: "board-a" })))).searchParams.get("error")).toBe("permission");

    mocks.guard.mockResolvedValueOnce({ kind: "denied", reason: "unavailable" });
    expect((await landing(restoreBoardAction(form({ boardId: "board-a" })))).searchParams.get("error")).toBe("unavailable");

    mocks.risky.mockResolvedValueOnce({ ok: false });
    expect((await landing(restoreBoardAction(form({ boardId: "board-a" })))).searchParams.get("error")).toBe("audit");

    expect(mocks.restoreBoard).not.toHaveBeenCalled();
  });

  it("같은 기본 탭이 다시 설치돼 있으면 그 사정을 알린다", async () => {
    mocks.restoreBoard.mockRejectedValueOnce(new DefaultTabAlreadyInstalledError());
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await landing(restoreBoardAction(form({ boardId: "board-a" })))).searchParams.get("error")).toBe("already-installed");
  });

  it("완전 삭제도 같은 관문을 지나고, 휴지통에 없는 탭은 «없음» 으로 알린다", async () => {
    const url = await landing(purgeBoardAction(form({ boardId: "board-a" })));
    expect(mocks.order).toEqual(["guard:danger.bulk_edit_delete", "audit", "purge"]);
    expect(mocks.risky).toHaveBeenCalledWith("org-a", "danger.bulk_edit_delete", { operation: "board_trash.purge", boardId: "board-a" });
    expect(Object.fromEntries(url.searchParams)).toEqual({ section: "tabs", purged: "1" });

    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.purgeBoard.mockRejectedValueOnce(new NotFoundError("휴지통에서 탭을 찾을 수 없습니다"));
    expect((await landing(purgeBoardAction(form({ boardId: "board-a" })))).searchParams.get("error")).toBe("not-in-trash");

    mocks.purgeBoard.mockRejectedValueOnce(new Error("network"));
    expect((await landing(purgeBoardAction(form({ boardId: "board-a" })))).searchParams.get("error")).toBe("purge-failed");
  });

  it("기본 탭 다시 설치는 탭 관리 권한으로 기록을 지운 뒤 같은 정의로 빈 탭을 만든다", async () => {
    const url = await landing(reinstallDefaultTabAction(form({ source: "core.default-tab/notice" })));
    expect(mocks.order).toEqual(["guard:structure.tab_manage", "clear", "ensure"]);
    expect(mocks.risky).not.toHaveBeenCalled();
    expect(mocks.clearDefaultTabDismissal).toHaveBeenCalledWith(expect.anything(), "core.default-tab/notice");
    expect(mocks.ensureDefaultTab).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "core.default-tab/notice" }),
      mocks.repo,
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({ section: "tabs", reinstalled: "core.default-tab/notice" });
  });

  it("모르는 기본 탭은 권한 확인도 하지 않고 돌려보낸다", async () => {
    const url = await landing(reinstallDefaultTabAction(form({ source: "pack.example" })));
    expect(url.searchParams.get("error")).toBe("unknown-default-tab");
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.ensureDefaultTab).not.toHaveBeenCalled();
  });

  it("설치가 실패하면 전면 오류 대신 다시 시도 안내로 돌아간다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.ensureDefaultTab.mockRejectedValueOnce(new Error("rpc down"));
    expect((await landing(reinstallDefaultTabAction(form({ source: "core.default-tab/new-lead" })))).searchParams.get("error")).toBe("reinstall-failed");
  });
});
