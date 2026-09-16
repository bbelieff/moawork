// Entry-performance: workspace-entry page must issue its two independent
// reads together. Serial code would not start the entry context until the
// routing snapshot resolves, so gating the snapshot while watching the
// context separates the two implementations deterministically.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  context: vi.fn(),
}));

vi.mock("@/lib/auth/workspace-entry-server", () => ({
  loadWorkspaceRoutingSnapshot: mocks.snapshot,
}));
vi.mock("@/lib/workspace-entry/server", async (importOriginal) => {
  const mod = await importOriginal<
    typeof import("@/lib/workspace-entry/server")
  >();
  return { ...mod, loadWorkspaceEntryContext: mocks.context };
});
vi.mock("@/components/workspace-entry/WorkspaceEntry", () => ({
  WorkspaceEntry: () => null,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`HARNESS_REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import WorkspaceEntryPage from "./page";

describe("workspace-entry page entry performance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the routing snapshot and the entry context together, not in series", async () => {
    let contextStarted = false;
    mocks.context.mockImplementation(async () => {
      contextStarted = true;
      return {
        kind: "ready",
        isPlatformAdmin: false,
        requests: [],
        platformCreateRequests: [],
        ownerJoinRequests: [],
        ownerPendingApprovalCount: 0,
      };
    });
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

    const pending = WorkspaceEntryPage({
      searchParams: Promise.resolve({}),
    });
    // 스냅샷이 끝나기 전에 컨텍스트가 출발해야 한다 — 직렬 코드라면
    // 스냅샷이 풀리기 전까지 컨텍스트는 절대 시작되지 않는다.
    await vi.waitFor(
      () => {
        expect(contextStarted).toBe(true);
      },
      { timeout: 2000, interval: 10 },
    );
    releaseSnapshot();
    // 2 memberships → /workspaces redirect. The redirect proves both reads
    // completed and the unchanged decision logic ran on their results.
    await expect(pending).rejects.toThrow("HARNESS_REDIRECT:/workspaces");
  });
});
