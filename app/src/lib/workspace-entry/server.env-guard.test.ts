import { afterEach, describe, expect, it, vi } from "vitest";

// workspace-entry-server.env-guard.test.ts 와 같은 계약의 나머지 절반.
// (app) 레이아웃은 이 둘도 최상단에서 부른다 — 하나라도 던지면 셸 전체가 500 이다.

const createClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient }));

afterEach(() => {
  vi.unstubAllEnvs();
  createClient.mockReset();
});

function clearSupabaseEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
}

describe("workspace-entry 로더 — Supabase 미설정 가드", () => {
  it("loadWorkspaceApprovals 는 던지지 않고 승인 대기 0건을 돌려준다", async () => {
    clearSupabaseEnv();
    const { loadWorkspaceApprovals } = await import("./server");

    await expect(loadWorkspaceApprovals("org-1")).resolves.toEqual({ pendingCount: 0 });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("loadWorkspaceEntryContext 는 던지지 않고 error 스냅샷을 돌려준다", async () => {
    clearSupabaseEnv();
    const { loadWorkspaceEntryContext } = await import("./server");

    await expect(loadWorkspaceEntryContext("org-1")).resolves.toEqual({ kind: "error" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("승인 대기 건수를 «모른다» 를 «0 건» 으로 보여주는 것이 의도된 축소임을 고정한다", async () => {
    clearSupabaseEnv();
    const { loadWorkspaceApprovals } = await import("./server");

    // 0 건이면 레이아웃이 승인 대기 배지를 아예 그리지 않는다. 조회 못 한 상태에서
    // 숫자를 지어내지 않는 쪽이 안전하다 — 없는 승인 요청을 있다고 말하지 않는다.
    const approvals = await loadWorkspaceApprovals("org-1");
    expect(approvals.pendingCount).toBe(0);
  });
});
