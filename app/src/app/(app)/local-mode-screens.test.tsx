import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BBE-190 1층 — «환경변수가 없어도 화면이 뜬다» 를 기계가 잰다.
 *
 * 왜 필요한가: 지금까지 화면이 500 이 나도 `check.sh` 는 초록이었다. 회사·공지가 로컬 시드
 * 모드에서 죽어 있었는데 아무 테스트도 빨개지지 않았다. 그래서 §3 «화면 확인» 이 막혔다.
 *
 * 이 파일이 빨개지는 조건 — 전부 실제 회귀다:
 *  ① 페이지가 `hasSupabaseEnv()` 가드 없이 `createClient()` 를 부른다 → 렌더가 throw
 *  ② 미연결 상태를 «빈 목록» 으로 위장한다 → 문구 단언에서 걸린다
 *  ③ 미연결을 «오류» 라고 말한다 → 두 문구를 갈라 단언한다
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

// 서버 액션 모듈은 렌더 대상이 아니다. 폼 action 자리만 채운다.
vi.mock("./notices/actions", () => ({
  createNoticeAction: vi.fn(),
  deleteNoticeAction: vi.fn(),
  endNoticeAction: vi.fn(),
  resumeNoticeAction: vi.fn(),
  toggleNoticePinAction: vi.fn(),
  updateNoticeAction: vi.fn(),
}));

import CompaniesPage from "./companies/page";
import NoticesPage from "./notices/page";

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

type Screen = {
  route: string;
  render: () => Promise<string>;
  /** 미연결일 때 반드시 보여야 하는 말. */
  notConnected: string;
  /** 미연결을 이 말로 부르면 안 된다 — 오류도 아니고 «0건» 도 아니다. */
  mustNotSay: readonly string[];
};

const screens: readonly Screen[] = [
  {
    route: "/companies",
    render: async () =>
      renderToStaticMarkup(await CompaniesPage({ searchParams: Promise.resolve({}) })),
    notConnected: "아직 연결되지 않았습니다",
    mustNotSay: ["등록된 회사가 없습니다", "회사 정보를 불러오지 못했습니다"],
  },
  {
    route: "/notices",
    render: async () =>
      renderToStaticMarkup(await NoticesPage({ searchParams: Promise.resolve({}) })),
    notConnected: "아직 연결되지 않았습니다",
    mustNotSay: ["공지사항을 불러오지 못했습니다"],
  },
];

describe("로컬 시드 모드에서 주요 화면이 뜬다 (BBE-190 1층)", () => {
  for (const screen of screens) {
    describe(screen.route, () => {
      it("환경변수 없이도 렌더가 실패하지 않는다", async () => {
        // 가드가 없으면 여기서 «Supabase 환경변수 누락…» 이 그대로 터진다.
        await expect(screen.render()).resolves.toBeTypeOf("string");
      });

      it("«아직 연결 안 됨» 을 말한다", async () => {
        expect(await screen.render()).toContain(screen.notConnected);
      });

      it("미연결을 빈 목록이나 오류로 위장하지 않는다", async () => {
        const html = await screen.render();
        for (const phrase of screen.mustNotSay) expect(html).not.toContain(phrase);
      });
    });
  }
});

describe("보드 엔진 팩토리가 가드와 같은 조건을 쓴다", () => {
  it("URL 만 있고 ANON_KEY 가 없으면 원격 어댑터로 가지 않는다", async () => {
    // 예전에는 URL 하나만 봤다. 그 상태에서는 가드를 세워 둔 화면도 createClient() 에서 죽었다.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const [{ getBoardsRepo }, { hasSupabaseEnv }] = await Promise.all([
      import("@/lib/repo/local/boardsRepo"),
      import("@/lib/supabase/env"),
    ]);
    expect(hasSupabaseEnv()).toBe(false);
    // throw 하지 않고 로컬 어댑터를 돌려준다.
    await expect(getBoardsRepo()).resolves.toBeDefined();
  });
});
