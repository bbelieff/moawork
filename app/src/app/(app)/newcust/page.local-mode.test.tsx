import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BBE-171 — `/newcust` 가 환경변수 없이도 뜬다.
 *
 * 왜 필요한가: 로컬 시드 모드에서 이 화면이 **500** 이었다(실측:
 * `GET /newcust 500` · `Error: Supabase 환경변수 누락`). `page.tsx` 가
 * `hasSupabaseEnv()` 가드 없이 `createClient()` 를 부르기 때문이다.
 * 그런데 `check.sh` 는 초록이었다 — 화면이 죽어도 아무 테스트가 빨개지지 않았다.
 * 그래서 AGENTS.md §3 «화면 확인» 이 이 카드에서 아예 막혀 있었다.
 *
 * 이 파일이 빨개지는 조건 — 전부 실제 회귀다:
 *  ① 가드 없이 `createClient()` 를 부른다 → 렌더가 throw
 *  ② 미연결을 «보드를 찾을 수 없다» 로 위장한다 → 관리자에게 잘못된 문의를 하게 만든다
 *
 * ※ BBE-190(PR #249)이 `local-mode-screens.test.tsx` 로 같은 검사를 회사·공지에 대해
 *   세운다. 그 PR 이 머지되면 이 파일은 그쪽으로 합치는 게 맞다 — 지금 같은 이름으로
 *   만들면 충돌하므로 라우트 옆에 따로 뒀다.
 */

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({
    user: { id: "user-1" },
    org: { id: "org-1" },
    role: "owner",
    scope: "all",
    isPlatformAdmin: false,
  })),
  applyAs: vi.fn((ctx: unknown) => ctx),
}));

import NewCustomerPage from "./page";

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const render = async () =>
  renderToStaticMarkup(await NewCustomerPage({ searchParams: Promise.resolve({}) }));

describe("BBE-171 · /newcust 로컬 시드 모드", () => {
  it("환경변수가 없어도 렌더가 죽지 않는다", async () => {
    // 가드를 지우면 `createClient()` 가 throw 해서 여기서 걸린다 (= 화면 500).
    await expect(render()).resolves.toBeTypeOf("string");
  });

  it("«아직 연결 안 됨» 이라고 말한다", async () => {
    const html = await render();

    expect(html).toContain("아직 연결되지 않았습니다");
    expect(html).toContain('role="status"');
  });

  it("미연결을 «보드를 찾을 수 없다» 로 위장하지 않는다", async () => {
    const html = await render();

    // 이 문구들은 «물어봤는데 없더라» 는 뜻이다. 아직 물어보지도 못한 상태에 쓰면
    // 사용자가 회사 관리자에게 엉뚱한 문의를 하게 된다.
    expect(html).not.toContain("신규리드 보드를 찾을 수 없습니다");
    expect(html).not.toContain("회사 관리자에게 문의해 주세요");
    expect(html).not.toContain("복구 권한이 없습니다");
  });
});
