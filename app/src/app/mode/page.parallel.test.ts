// Entry-performance: mode page must issue the routing snapshot and the
// platform actor check together. Serial code would not start the actor
// check until the snapshot resolves, so gating the snapshot while watching
// the actor separates the two implementations deterministically.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  actor: vi.fn(),
}));

vi.mock("@/lib/auth/workspace-entry-server", () => ({
  loadWorkspaceRoutingSnapshot: mocks.snapshot,
}));
vi.mock("@/lib/platform/actor", () => ({
  loadPlatformActor: mocks.actor,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`HARNESS_REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import ModePage from "./page";

describe("mode page entry performance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the routing snapshot and the platform actor together, not in series", async () => {
    let actorStarted = false;
    mocks.actor.mockImplementation(async () => {
      actorStarted = true;
      return { kind: "denied", reason: "not_platform" };
    });
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    mocks.snapshot.mockImplementation(() =>
      snapshotGate.then(() => ({
        kind: "ready",
        selfRouteState: "eligible_entry",
        memberships: [{ orgId: "org-1", slug: "acme" }],
      })),
    );

    const pending = ModePage({ searchParams: Promise.resolve({}) });
    // 스냅샷이 끝나기 전에 액터 조회가 출발해야 한다 — 직렬 코드라면
    // 스냅샷이 풀리기 전까지 액터는 절대 시작되지 않는다.
    await vi.waitFor(
      () => {
        expect(actorStarted).toBe(true);
      },
      { timeout: 2000, interval: 10 },
    );
    releaseSnapshot();
    // 1 membership + denied platform + no preference → /w/acme redirect.
    // The redirect proves both reads completed and the unchanged decision
    // logic ran on their results.
    await expect(pending).rejects.toThrow("HARNESS_REDIRECT:/w/acme");
  });
});
