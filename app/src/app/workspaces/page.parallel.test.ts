// Entry-performance: workspaces page must issue the routing snapshot and
// the owner deletion rows together. Serial code would not start the
// deletion-rows read until the snapshot resolves, so gating the snapshot
// while watching the deletion read separates the two implementations
// deterministically.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  ownerRows: vi.fn(),
  badges: vi.fn(),
}));

vi.mock("@/lib/auth/workspace-entry-server", () => ({
  loadWorkspaceRoutingSnapshot: mocks.snapshot,
}));
vi.mock("@/lib/workspace-deletion/server", () => ({
  loadOwnerWorkspaceDeletionRows: mocks.ownerRows,
}));
vi.mock("@/lib/notify/server", () => ({
  loadOrgActionCounts: mocks.badges,
}));
vi.mock("@/components/workspace-entry/WorkspaceChooser", () => ({
  WorkspaceChooser: () => null,
}));
vi.mock("@/components/account/WorkspaceManagementPanel", () => ({
  WorkspaceManagementPanel: () => null,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`HARNESS_REDIRECT:${url}`);
  },
}));

import WorkspacesPage from "./page";

describe("workspaces page entry performance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the routing snapshot and the owner rows together, not in series", async () => {
    let ownerRowsStarted = false;
    mocks.ownerRows.mockImplementation(async () => {
      ownerRowsStarted = true;
      return [];
    });
    mocks.badges.mockResolvedValue({});
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    mocks.snapshot.mockImplementation(() =>
      snapshotGate.then(() => ({
        kind: "ready",
        selfRouteState: "eligible_entry",
        memberships: [
          { orgId: "org-1", slug: "alpha-team", name: "회사 1", role: "member" },
          { orgId: "org-2", slug: "beta-team", name: "회사 2", role: "member" },
        ],
      })),
    );

    const pending = WorkspacesPage();
    // 스냅샷이 끝나기 전에 삭제행 조회가 출발해야 한다 — 직렬 코드라면
    // 스냅샷이 풀리기 전까지 삭제행 조회는 절대 시작되지 않는다.
    await vi.waitFor(
      () => {
        expect(ownerRowsStarted).toBe(true);
      },
      { timeout: 2000, interval: 10 },
    );
    releaseSnapshot();
    // 2 memberships → badges load → chooser element. Resolving to the
    // chooser (instead of redirecting) proves the unchanged branch logic
    // ran on both reads' results.
    const element = (await pending) as { type?: unknown };
    const { WorkspaceChooser } = await import(
      "@/components/workspace-entry/WorkspaceChooser"
    );
    expect(element?.type).toBe(WorkspaceChooser);
    expect(mocks.badges).toHaveBeenCalledOnce();
  });
});
