import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// 운영 저장소 경계 (BBE-203 에서 «구문 가드» → «행위 가드» 로 교체)
//
// 이 경계가 지키는 것은 한 줄이다: **운영에서 조용한 시드 노출 0.**
//
// 예전 검사: 파일에 `getRepo(` 라는 글자가 없다.
//   → 이름만 감싸면(`const r = getRepo; r()`) 그대로 통과한다. 아래 마지막 테스트가 그걸 보인다.
// 지금 검사: 아래 «네 줄» 을 행위로 단언한다. 감싸든 말든 빨개진다.
//
//   운영 빌드 + env 있음 → Supabase   (종전과 동일)
//   운영 빌드 + env 없음 → 던진다      ★ 종전과 동일 — 경계의 핵심
//   개발 빌드 + env 없음 → 로컬 시드   ← 이것만 새로 열렸다
//   개발 빌드 + env 있음 → Supabase   (종전과 동일)
//
// 이 교체는 DC-12 가 임의로 낮춘 것이 아니라 DC-00 이 조건 넷을 걸어 승인했다.
// page.tsx·service.ts 는 strict-zero 에 그대로 남는다(폴백이 없어야 하는 자리).
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({ getRepo: vi.fn() }));
vi.mock("@/lib/repo", () => ({ getRepo: mocks.getRepo }));

const staticallyPureFiles = [
  new URL("../../app/(app)/page.tsx", import.meta.url),
  new URL("./service.ts", import.meta.url),
];

const CTX = { org: { id: "org-1" }, user: { id: "user-1" }, role: "owner", scope: "all" } as never;

function fakeSupabaseClient() {
  const result = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const key of ["select", "eq", "order", "in", "gte", "lte", "limit"]) builder[key] = () => builder;
  builder.then = (resolve: (value: typeof result) => unknown) => resolve(result);
  builder.maybeSingle = async () => ({ data: null, error: null });
  return { from: () => builder } as never;
}

function setEnv(present: boolean) {
  if (present) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-test-key";
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
}

/** NODE_ENV 는 읽기 전용 취급이라 vitest 의 stubEnv 로 갈아끼운다. */
function setNodeEnv(value: string) {
  vi.stubEnv("NODE_ENV", value);
}

describe("dashboard production repository boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getRepo.mockReset();
    mocks.getRepo.mockImplementation(() => {
      throw new Error("운영 경로가 LocalRepo 를 건드렸다");
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setEnv(false);
  });

  it("keeps the non-fallback files free of any repo import", () => {
    for (const file of staticallyPureFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file.pathname).not.toMatch(/\bgetRepo\s*\(/);
      expect(source, file.pathname).not.toMatch(/\bLocalRepo\b/);
    }
  });

  // ── 표 1행 ──
  // 되돌리면 빨개진다: env 가 있어도 폴백을 타도록 분기를 뒤집기
  it("① 운영 빌드 + env 있음 → 로컬을 단 한 번도 건드리지 않는다", async () => {
    setNodeEnv("production");
    setEnv(true);
    const { loadDashboardPageData } = await import("./server");
    await loadDashboardPageData(CTX, { clientFactory: async () => fakeSupabaseClient() });
    expect(mocks.getRepo).not.toHaveBeenCalled();
  });

  // ── 표 2행 · ★ 경계의 핵심 ──
  // 되돌리면 빨개진다: 폴백 조건에서 NODE_ENV 검사를 빼고 hasSupabaseEnv() 만 보게 하기.
  // 그러면 운영에서 env 가 빠졌을 때 «시드 데이터가 조용히» 사용자 화면에 뜬다.
  it("② 운영 빌드 + env 없음 → 조용히 시드로 떨어지지 않고 던진다", async () => {
    setNodeEnv("production");
    setEnv(false);
    const { loadDashboardPageData } = await import("./server");

    // 여기서 «어떤» 오류가 나는지는 실행 맥락에 따라 다르다(테스트에서는 cookies() 가 먼저 걸린다).
    // 고정해야 할 성질은 메시지가 아니라 두 가지다: **던진다**, 그리고 **로컬을 건드리지 않는다**.
    // 조용히 시드를 돌려주는 것만 막으면 된다.
    await expect(loadDashboardPageData(CTX)).rejects.toThrow();
    expect(mocks.getRepo).not.toHaveBeenCalled();
  });

  // ── 표 3행 ──
  // 되돌리면 빨개진다: 폴백을 지워 createClient() 가 개발에서도 던지게 하기
  it("③ 개발 빌드 + env 없음 → 던지지 않고 로컬 시드로 읽는다", async () => {
    setNodeEnv("development");
    setEnv(false);
    mocks.getRepo.mockImplementation(() => ({ listFieldDefs: () => [], listSettlements: () => [] }));
    const { loadDashboardPageData } = await import("./server");

    const model = await loadDashboardPageData(CTX);
    expect(mocks.getRepo).toHaveBeenCalled();
    expect(model.core.status === "ready" || model.core.status === "unavailable").toBe(true);
  });

  // ── 표 4행 ──
  it("④ 개발 빌드 + env 있음 → 로컬을 건드리지 않는다", async () => {
    setNodeEnv("development");
    setEnv(true);
    const { loadDashboardPageData } = await import("./server");
    await loadDashboardPageData(CTX, { clientFactory: async () => fakeSupabaseClient() });
    expect(mocks.getRepo).not.toHaveBeenCalled();
  });

  // 없는 숫자를 있는 척하지 않는다 — 로컬에는 원장이 없다.
  // 되돌리면 빨개진다: loadLedger 가 0 을 돌려주게 바꾸기
  it("로컬에서 원장은 «조회 불가» 이지 0 이 아니다", async () => {
    setNodeEnv("development");
    setEnv(false);
    mocks.getRepo.mockImplementation(() => ({ listFieldDefs: () => [], listSettlements: () => [] }));
    const { loadDashboardPageData } = await import("./server");

    const model = await loadDashboardPageData(CTX);
    expect(model.ledger.status).toBe("unavailable");
  });

  // ── ★ 「행위 가드가 구문 가드보다 강하다」를 주장이 아니라 «측정» 으로 남긴다 ──
  // 구문 가드는 `getRepo(` 라는 글자만 봤다. 아래처럼 이름을 한 번 감싸면 글자가 사라진다.
  // 즉 구문 가드는 이 우회를 통과시킨다 — 그래서 교체가 필요했다.
  // (위 ①②④ 가 «행위» 를 보므로, 감싸서 부르든 직접 부르든 로컬을 건드리면 빨개진다.)
  it("구문 가드는 이름 감싸기로 우회된다 — 행위 가드는 그렇지 않다", () => {
    const bypass = "const wrapped = getRepo;\nconst repo = wrapped();";
    // 예전 구문 가드의 정규식 그대로.
    expect(bypass).not.toMatch(/\bgetRepo\s*\(/); // ← 우회 성공(구문 가드 통과)
    expect(bypass).toContain("getRepo"); // ← 그런데 실제로는 LocalRepo 를 부른다
  });
});
