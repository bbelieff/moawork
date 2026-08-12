import { afterEach, describe, expect, it, vi } from "vitest";

// Supabase 환경변수가 없는 로컬 dev 에서 (app) 셸이 500 나지 않는다는 계약.
// 예전에는 loadWorkspaceRoutingSnapshot 이 createClient() 에서 던졌고, 그것이 레이아웃
// (app/src/app/(app)/layout.tsx) 최상단이라 «로그인한 화면» 을 아무도 열어볼 수 없었다.
// 촬영 증거(AGENTS §3)가 반복해서 NOT_RUN 으로 남은 실제 원인이다.

const createClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient }));

afterEach(() => {
  vi.unstubAllEnvs();
  createClient.mockReset();
});

describe("loadWorkspaceRoutingSnapshot — Supabase 미설정 가드", () => {
  it("환경변수가 없으면 던지지 않고 unauthenticated 를 돌려준다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { loadWorkspaceRoutingSnapshot } = await import("./workspace-entry-server");

    await expect(loadWorkspaceRoutingSnapshot()).resolves.toEqual({ kind: "unauthenticated" });
    // 조회 자체를 시도하지 않는다 — 클라이언트를 만들지 않는 것이 가드의 요점이다.
    expect(createClient).not.toHaveBeenCalled();
  });

  it("환경변수가 있으면 평소대로 Supabase 로 조회한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-test");
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const { loadWorkspaceRoutingSnapshot } = await import("./workspace-entry-server");

    await expect(loadWorkspaceRoutingSnapshot()).resolves.toEqual({ kind: "unauthenticated" });
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
