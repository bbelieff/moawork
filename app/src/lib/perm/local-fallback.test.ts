import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BBE-207 — 개발 빌드 + Supabase 없음에서 권한 «조회» 가 성공하게 한다.
//
// 그동안 createClient() 가 던져 { ok:false } 가 됐고, 호출부는 그걸 「권한 없음」과 구별 못 해
// 화면을 닫았다. 즉 로컬에서는 권한을 통과할 방법이 아예 없었다.
//
// ★ 전부 허용하지 않는다. 운영과 «같은 표»(matrix.ts)의 역할 기본값을 그대로 계산한다.
//   BBE-203 이 세운 네 줄 규칙을 권한 계층에 그대로 적용한다.

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

function setEnv(present: boolean) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", present ? "https://example.supabase.test" : "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", present ? "public-anon-test-key" : "");
}

const OWNER = { org: { id: "org-1" }, user: { id: "u1" }, role: "owner", scope: "all" };
const MEMBER = { org: { id: "org-1" }, user: { id: "u2" }, role: "member", scope: "assigned" };

describe("BBE-207 권한 조회 로컬 폴백 — 네 줄 규칙", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSession.mockReset();
    mocks.createClient.mockReset();
    mocks.createClient.mockImplementation(async () => {
      throw new Error("Supabase 환경변수 누락");
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  // ── 표 2행 · ★ 안전 성질 ──
  // 되돌리면 빨개진다: 조건에서 NODE_ENV 검사를 빼기.
  // 그러면 운영에서 env 가 빠졌을 때 «시드 역할» 로 권한이 판정된다 — 조용한 권한 오판이다.
  it("② 운영 빌드 + env 없음 → 세션을 보지도 않고 판정 불능", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv(false);
    const { loadEffectivePermission } = await import("./server");

    expect(await loadEffectivePermission("org-1", "work.view_tabs")).toEqual({ ok: false });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  // ── 표 1행 ──
  it("① 운영 빌드 + env 있음 → 로컬 판정을 쓰지 않는다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv(true);
    mocks.createClient.mockResolvedValue({ rpc: async () => ({ data: true, error: null }) });
    const { loadEffectivePermission } = await import("./server");

    expect(await loadEffectivePermission("org-1", "work.view_tabs")).toEqual({ ok: true, allowed: true });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  // ── 표 4행 ──
  it("④ 개발 빌드 + env 있음 → 로컬 판정을 쓰지 않는다", async () => {
    vi.stubEnv("NODE_ENV", "development");
    setEnv(true);
    mocks.createClient.mockResolvedValue({ rpc: async () => ({ data: false, error: null }) });
    const { loadEffectivePermission } = await import("./server");

    expect(await loadEffectivePermission("org-1", "work.view_tabs")).toEqual({ ok: true, allowed: false });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  // ── 표 3행 — 이것만 새로 열린다 ──
  // 되돌리면 빨개진다: 폴백을 지워 다시 { ok:false } 가 되게 하기
  it("③ 개발 빌드 + env 없음 → 역할 기본값으로 «판정한다»", async () => {
    vi.stubEnv("NODE_ENV", "development");
    setEnv(false);
    mocks.getSession.mockResolvedValue(OWNER);
    const { loadEffectivePermission } = await import("./server");

    expect(await loadEffectivePermission("org-1", "work.view_tabs")).toEqual({ ok: true, allowed: true });
  });

  // ★ 되돌리면 빨개진다: 로컬에서 무조건 allowed:true 를 돌려주기(전부 허용).
  // 로컬이라고 권한을 열어주면 그건 접근 범위를 넓힌 것이다.
  it("로컬이라고 전부 허용하지 않는다 — member 는 owner 전용 기능을 못 연다", async () => {
    vi.stubEnv("NODE_ENV", "development");
    setEnv(false);
    mocks.getSession.mockResolvedValue(MEMBER);
    const { loadEffectivePermission } = await import("./server");

    const danger = await loadEffectivePermission("org-1", "danger.bulk_edit_delete");
    expect(danger).toEqual({ ok: true, allowed: false });
  });

  // 되돌리면 빨개진다: 모르는 scopeKey 를 true 로 돌려주기
  it("모르는 scopeKey 는 닫힘이다", async () => {
    vi.stubEnv("NODE_ENV", "development");
    setEnv(false);
    mocks.getSession.mockResolvedValue(OWNER);
    const { loadEffectivePermission } = await import("./server");

    expect(await loadEffectivePermission("org-1", "does.not.exist")).toEqual({ ok: true, allowed: false });
  });

  // ★ D24 범위 — 좁은 범위는 로컬에서 «계산하지 않고 닫는다».
  // 되돌리면 빨개진다: assigned 에도 전체 아이템을 돌려주기 → 그건 정보 노출이다.
  it("좁은 조회 범위(assigned)는 로컬에서 열지 않는다", async () => {
    vi.stubEnv("NODE_ENV", "development");
    setEnv(false);
    mocks.getSession.mockResolvedValue(MEMBER);
    const { loadPermissionScopedWorkItems } = await import("./server");

    expect(await loadPermissionScopedWorkItems("org-1")).toEqual({ ok: false, reason: "unavailable" });
  });
});
