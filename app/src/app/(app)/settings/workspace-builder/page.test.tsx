import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "owner",
  order: [] as string[],
  purgeExpiredBoards: vi.fn(),
  listBoards: vi.fn(),
  listTrashedBoards: vi.fn(),
  listDefaultTabDismissals: vi.fn(),
  listStoragePurgeQueue: vi.fn(),
  ackStoragePurge: vi.fn(),
  remove: vi.fn(),
  bucket: vi.fn(),
  hasClient: true,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "user-a" }, role: mocks.role })),
}));
vi.mock("@/components/workspace-builder/BuilderWorkspaceSurface", () => ({ BuilderWorkspaceSurface: () => <p>migration</p> }));
vi.mock("@/components/workspace-builder/WorkflowManagementSurface", () => ({ WorkflowManagementSurface: () => <p>workflow</p> }));
vi.mock("@/lib/dynamic-workspace/workspace-ops", () => ({ loadOwnerWorkspaceOpsSnapshot: vi.fn(async () => ({})) }));
vi.mock("@/app/(app)/settings/workspace-builder/tab-actions", () => ({
  restoreBoardAction: async () => {},
  purgeBoardAction: async () => {},
  reinstallDefaultTabAction: async () => {},
}));
vi.mock("@/lib/default-tabs/install", () => ({
  DEFAULT_TABS: [{ key: "notice", source: "core.default-tab/notice", name: "공지" }],
}));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    client: mocks.hasClient
      ? { storage: { from: (bucket: string) => { mocks.bucket(bucket); return { remove: mocks.remove }; } } }
      : null,
    repo: { listStoragePurgeQueue: mocks.listStoragePurgeQueue, ackStoragePurge: mocks.ackStoragePurge },
    service: {
      purgeExpiredBoards: mocks.purgeExpiredBoards,
      listBoards: mocks.listBoards,
      listTrashedBoards: mocks.listTrashedBoards,
      listDefaultTabDismissals: mocks.listDefaultTabDismissals,
    },
  }),
}));

import WorkspaceBuilderPage from "./page";

const TRASHED = {
  id: "trash-1",
  org_id: "org-a",
  name: "옛 탭",
  description: null,
  icon: null,
  is_system: false,
  source: null,
  sort_order: 0,
  created_by: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  // 오늘(테스트 시각)과 무관하게 «휴지통에 있는 탭» 이면 된다.
  deleted_at: new Date().toISOString(),
};

async function render(searchParams: Record<string, string>): Promise<string> {
  return renderToStaticMarkup(await WorkspaceBuilderPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("탭 관리 › 탭 목록·휴지통", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "owner";
    mocks.hasClient = true;
    mocks.order.length = 0;
    mocks.purgeExpiredBoards.mockImplementation(async () => { mocks.order.push("purge-expired"); return 1; });
    mocks.listBoards.mockImplementation(async () => {
      mocks.order.push("list");
      return [{ ...TRASHED, id: "active-1", name: "사후 관리", deleted_at: null, nav_section: "after-contract" }];
    });
    mocks.listTrashedBoards.mockImplementation(async () => { mocks.order.push("list-trash"); return [TRASHED]; });
    mocks.listDefaultTabDismissals.mockResolvedValue([]);
    mocks.listStoragePurgeQueue.mockResolvedValue(["org-a/board/item/a.pdf", "org-a/board/item/b.pdf"]);
    mocks.remove.mockResolvedValue({ data: [{ name: "org-a/board/item/a.pdf" }], error: null });
    mocks.ackStoragePurge.mockResolvedValue(1);
  });

  it("메뉴에 «탭 목록·휴지통» 이 기존 두 메뉴와 함께 있다", async () => {
    const html = await render({ section: "tabs" });
    expect(html).toContain('href="/settings/workspace-builder?section=migration"');
    expect(html).toContain('href="/settings/workspace-builder?section=workflow"');
    expect(html).toMatch(/href="\/settings\/workspace-builder\?section=tabs" aria-current="page"[^>]*>탭 목록·휴지통/);
  });

  it("열 때 7일 지난 탭을 먼저 지우고, 저장소 정리가 성공한 묶음은 통째로 큐에서 뺀다", async () => {
    const html = await render({ section: "tabs" });
    expect(mocks.order[0]).toBe("purge-expired");
    expect(mocks.purgeExpiredBoards).toHaveBeenCalledWith(expect.objectContaining({ org: { id: "org-a" } }));
    expect(mocks.bucket).toHaveBeenCalledWith("board-item-files");
    expect(mocks.remove).toHaveBeenCalledWith(["org-a/board/item/a.pdf", "org-a/board/item/b.pdf"]);
    // b.pdf 는 저장소에 없던 파일(올리다 만 예약) — 그래도 빼야 큐 머리가 막히지 않는다.
    expect(mocks.ackStoragePurge).toHaveBeenCalledWith(expect.anything(), ["org-a/board/item/a.pdf", "org-a/board/item/b.pdf"]);
    expect(html).toContain("사후 관리");
    expect(html).toContain("옛 탭");
    expect(html).toContain("7일 남음");
  });

  it("정리가 실패해도 화면은 그린다 — 큐는 그대로 두고 다음에 다시 시도한다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.purgeExpiredBoards.mockRejectedValue(new Error("permission_denied"));
    mocks.remove.mockResolvedValue({ data: null, error: new Error("storage down") });
    const html = await render({ section: "tabs" });
    expect(mocks.ackStoragePurge).not.toHaveBeenCalled();
    expect(html).toContain("옛 탭");
  });

  it("로컬(클라이언트 없음)에서는 저장소 정리를 건너뛴다", async () => {
    mocks.hasClient = false;
    await render({ section: "tabs" });
    expect(mocks.listStoragePurgeQueue).not.toHaveBeenCalled();
  });

  it("탭을 지우고 돌아오면 언제 완전히 지워지는지 알려 준다", async () => {
    const html = await render({ section: "tabs", trashed: "trash-1" });
    expect(html).toContain("‘옛 탭’을 휴지통으로 옮겼어요 · ");
    expect(html).toContain("에 완전히 지워져요");
  });

  it("다른 메뉴에서는 휴지통 정리를 돌리지 않는다", async () => {
    await render({ section: "workflow" });
    expect(mocks.purgeExpiredBoards).not.toHaveBeenCalled();
    expect(mocks.listStoragePurgeQueue).not.toHaveBeenCalled();
  });

  it("대표가 아니면 들어오지 못한다", async () => {
    mocks.role = "admin";
    await expect(render({ section: "tabs" })).rejects.toMatchObject({ digest: expect.stringContaining("/settings/members") });
    expect(mocks.purgeExpiredBoards).not.toHaveBeenCalled();
  });
});
