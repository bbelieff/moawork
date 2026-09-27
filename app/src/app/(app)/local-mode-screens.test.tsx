import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BBE-190 1층 — «환경변수가 없어도 화면이 뜬다» 를 기계가 잰다.
 *
 * 왜 필요한가: 지금까지 화면이 500 이 나도 `check.sh` 는 초록이었다. 회사·공지가 로컬 시드
 * 모드에서 죽어 있었는데 아무 테스트도 빨개지지 않았다. 그래서 §3 «화면 확인» 이 막혔다.
 *
 * ★ 이 파일은 «검사 목록» 이 아니라 **«(app) 라우트 전수 목록»** 이다.
 *   1차 판은 고친 화면 둘만 배열에 담았다. 그러면 **배열에서 한 줄을 지우는 것만으로 커버리지가
 *   사라지고**(독립 검수가 프로브로 실증), 무엇보다 **아직 안 고친 화면이 아무 데도 안 보였다.**
 *   실제로 그 시점에 `/`·`/newcust`·`/presets`·`/work` 가 500 이었는데 목록에 없었다.
 *   → 전수 목록 + 아직 죽은 것은 `known-500` 으로 **명시적 skip**. 그러면 둘 다 보인다:
 *     · 화면이 목록에서 빠지면 «전수 일치» 가 잡는다
 *     · 남은 일이 skip 목록으로 뜬다 (총괄 배분표가 된다)
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
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

import CompaniesPage from "./(tabs)/companies/page";
import NoticesPage from "./(tabs)/notices/page";
import PolicyNewsPage from "./policyfund/news/page";

type Coverage =
  /** 이 테스트가 **직접 렌더해서** 잰다. 주장은 여기까지만 하는 것이 정직하다. */
  | {
      status: "verified";
      render: () => Promise<string>;
      notConnected: string;
      mustNotSay: readonly string[];
    }
  /** 로컬 시드 모드에서 **아직 500** 이다. 고치면 `verified` 로 올린다. */
  | { status: "known-500"; owner: string }
  /** 200 인 것은 확인했지만 이 테스트가 렌더하지는 않는다(관측 기록이지 단언이 아니다). */
  | { status: "measured-ok" }
  /** 파라미터·리다이렉트라 이 방식으로 잴 수 없다. */
  | { status: "not-measurable"; why: string };

const renderCompanies = async () =>
  renderToStaticMarkup(await CompaniesPage({ searchParams: Promise.resolve({}) }));
const renderNotices = async () =>
  renderToStaticMarkup(await NoticesPage({ searchParams: Promise.resolve({}) }));

/**
 * `(app)` 그룹의 page 라우트 전수. 아래 «전수 일치» 테스트가 파일시스템과 대조한다.
 *
 * 상태는 2026-08-18 로컬 시드 모드 실측이다(dev 서버 + 시드 owner 쿠키).
 */
const SCREENS: Readonly<Record<string, Coverage>> = {
  "/policyfund/news": {
    status: "verified",
    render: async () => renderToStaticMarkup(PolicyNewsPage()),
    notConnected: "정책자금뉴스 최신호",
    mustNotSay: ["Application error", "회사 정보를 불러오지 못했습니다"],
  },
  "/companies": {
    status: "verified",
    render: renderCompanies,
    notConnected: "아직 연결되지 않았습니다",
    mustNotSay: ["등록된 회사가 없습니다", "회사 정보를 불러오지 못했습니다"],
  },
  "/notices": {
    status: "verified",
    render: renderNotices,
    notConnected: "아직 연결되지 않았습니다",
    mustNotSay: ["공지사항을 불러오지 못했습니다"],
  },

  // ── 아직 죽어 있다. 이 목록이 곧 남은 일이다 ──────────────────────────────
  "/newcust": { status: "known-500", owner: "BBE-171" },
  "/presets": { status: "known-500", owner: "미배정" },
  // 2026-08-25(#551) — /work 가 «그리는 화면» 에서 «리다이렉트» 로 바뀌었다.
  //   work-management 렌더러는 `태스크`(items.title) 컬럼을 전제하는데 이 보드엔 그 컬럼이
  //   없어 표에 업무 이름이 아예 안 나왔다(목업에도 그 열은 없다).
  //   이제 리드컨택(`/contract`)과 «같은 형태» 라 분류도 그쪽과 같아진다 — 여기서 렌더하지 않는다.
  "/work": { status: "measured-ok" },
  // BBE-240 — deal_ledger_entries 는 의도적으로 로컬 폴백이 없다(가짜 돈 데이터를 안 만든다,
  // accounting/actions.ts·server.ts 와 동일 원칙) — createClient() 가 env 없이 그대로 터진다.
  "/ledger": { status: "known-500", owner: "BBE-240" },
  // #711 A — 운영에서는 cookie-bound Supabase read model을 쓴다. 로컬 가짜 수납값을
  // 만들지 않으므로 env 없는 직접 page 호출은 의도적으로 연결 불가다(1440은 fixture 검증).
  "/dash/top-companies": { status: "known-500", owner: "#711 A" },

  // ── 200 확인됨 ─────────────────────────────────────────────────────────
  // ★ BBE-186(PR #246)이 홈을 V6 «오늘» 로 재구성하면서 500 을 없앴다. 2026-08-18 실측 200 ·
  //   「워크스페이스 데이터에 아직 연결되지 않았습니다」 표시. `loadTodayHome` 이
  //   `hasSupabaseEnv()` 가드 + try/catch 로 막는다(dash/today-server.ts:31).
  //   ※ `verified` 로 올리지 못한 이유: 홈 트리에 async 서버 컴포넌트(FeatureGateServer)가
  //     중첩돼 있어 `renderToStaticMarkup` 하네스로는 못 민다. 별도 카드감이다.
  "/": { status: "measured-ok" },
  "/contract": { status: "measured-ok" },
  // BBE-186 이 홈에서 옮겨온 «업무 분석». 홈과 같은 `hasSupabaseEnv()` 가드가
  // `createClient()` 앞에 있어(dash/page.tsx:63) 미연결에서도 죽지 않는다.
  "/dash": { status: "measured-ok" },
  "/dash/all": { status: "measured-ok" },
  "/dash/tasks": { status: "measured-ok" },
  "/onboarding": { status: "measured-ok" },
  "/onboarding/practice": { status: "measured-ok" },
  "/settings/account": { status: "measured-ok" },
  "/settings/account/privacy": { status: "measured-ok" },
  "/settings/account/sessions": { status: "measured-ok" },
  "/settings/automations": { status: "measured-ok" },
  "/settings/members": { status: "measured-ok" },
  "/settings/members/approvals": { status: "measured-ok" },
  "/settings/notifications": { status: "measured-ok" },
  "/settings/workspace-builder": { status: "measured-ok" },

  // ── 이 방식으로 잴 수 없는 것 ───────────────────────────────────────────
  "/account": { status: "not-measurable", why: "307 리다이렉트" },
  "/consult-remote": { status: "not-measurable", why: "인증된 정본 보드의 비대면 보기로 리다이렉트" },
  "/consult-inperson": { status: "not-measurable", why: "인증된 정본 보드의 대면 보기로 리다이렉트" },
  "/boards": { status: "not-measurable", why: "404 — 2층 권한 fail-closed. 별도 카드" },
  "/boards/[id]": { status: "not-measurable", why: "동적 파라미터" },
  "/companies/[companyId]": { status: "not-measurable", why: "동적 파라미터" },
  "/dash/[pipelineId]": { status: "not-measurable", why: "동적 파라미터" },
  "/deals/[dealId]": { status: "not-measurable", why: "동적 파라미터" },
  "/notices/[noticeId]": { status: "not-measurable", why: "동적 파라미터" },
};

const here = path.dirname(fileURLToPath(import.meta.url));

/** 디스크에 실재하는 `(app)` page 라우트. 라우트 그룹 `(...)` 세그먼트는 주소에 안 들어간다. */
function actualRoutes(dir = here, base: string[] = []): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      found.push(...actualRoutes(full, isGroup ? base : [...base, entry.name]));
    } else if (entry.name === "page.tsx") {
      found.push(`/${base.join("/")}`.replace(/\/$/, "") || "/");
    }
  }
  return found;
}

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

describe("(app) 라우트 전수 목록", () => {
  it("실재하는 라우트가 전부 목록에 있고, 목록에 유령 주소가 없다", () => {
    // ★ 이 단언이 «배열에서 한 줄 지우기» 를 막는다. 새 화면이 생겨도 여기서 걸린다.
    const actual = [...new Set(actualRoutes())].sort();
    const listed = Object.keys(SCREENS).sort();
    expect(listed).toEqual(actual);
  });

  it("아직 고치지 못한 화면을 숨기지 않는다", () => {
    // 남은 일이 0 이 되면 이 테스트를 지운다. 그때까지는 목록이 보여야 한다.
    const remaining = Object.entries(SCREENS)
      .filter(([, coverage]) => coverage.status === "known-500")
      .map(([route]) => route);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining).toEqual(["/newcust", "/presets", "/ledger", "/dash/top-companies"]);
  });
});

describe("로컬 시드 모드에서 주요 화면이 뜬다 (BBE-190 1층)", () => {
  for (const [route, coverage] of Object.entries(SCREENS)) {
    if (coverage.status !== "verified") {
      const reason =
        coverage.status === "known-500"
          ? `아직 500 — 소유: ${coverage.owner}`
          : coverage.status === "measured-ok"
            ? "200 확인됨 · 이 테스트가 렌더하진 않는다"
            : coverage.why;
      it.skip(`${route} — ${reason}`, () => undefined);
      continue;
    }

    describe(route, () => {
      it("환경변수 없이도 렌더가 실패하지 않는다", async () => {
        // 가드가 없으면 여기서 «Supabase 환경변수 누락…» 이 그대로 터진다.
        await expect(coverage.render()).resolves.toBeTypeOf("string");
      });

      it("화면의 기본 상태를 표시한다", async () => {
        expect(await coverage.render()).toContain(coverage.notConnected);
      });

      it("미연결을 빈 목록이나 오류로 위장하지 않는다", async () => {
        const html = await coverage.render();
        for (const phrase of coverage.mustNotSay) expect(html).not.toContain(phrase);
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
