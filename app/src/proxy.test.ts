import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { proxy } from "./proxy";

function membership(orgId: string, slug: string) {
  return { org_id: orgId, status: "active", role: "member", scope: "assigned", created_at: "2026-01-01T00:00:00Z", orgs: { id: orgId, slug, status: "active", name: "샘플", plan_tier: "t1_3", created_at: "2026-01-01T00:00:00Z" } };
}

function setup(user: { id: string } | null, rows: unknown[] = []) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  mocks.createServerClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, from: vi.fn(() => ({ select })) });
}

// ─────────────────────────────────────────────────────────────────────────────
// BBE-200 — 갱신 세션 쿠키가 «모든» 응답에 실리는가
//
// 기존 테스트가 이 결함을 통과시킨 이유: 위 setup() 의 가짜 클라이언트는
// getUser() 가 쿠키 어댑터의 setAll 을 «한 번도 부르지 않는다». 즉 토큰 회전이
// 일어나지 않는 세계만 검사했다 — 검사 경계가 실제 실행 경로보다 좁았다.
// 아래 setupRotating() 은 getUser() 안에서 실제로 setAll 을 호출해
// @supabase/ssr 의 토큰 회전을 재현한다.
// (쿠키 값은 전부 가짜다. 실제 토큰·키를 쓰지 않는다 — AGENTS.md §9.2)
// ─────────────────────────────────────────────────────────────────────────────

type WrittenCookie = { name: string; value: string; options: Record<string, unknown> };
type RefreshScript = (setAll: (cookies: WrittenCookie[]) => void) => void;

const ROTATED_0: WrittenCookie = { name: "sb-fake-auth-token.0", value: "rotated-fake-0", options: { path: "/" } };
const ROTATED_1: WrittenCookie = { name: "sb-fake-auth-token.1", value: "rotated-fake-1", options: { path: "/" } };
const CLEARED_0: WrittenCookie = { name: "sb-fake-auth-token.0", value: "", options: { path: "/", maxAge: 0 } };

/** 토큰 회전 1회 — 갱신된 쿠키 한 개를 내려보낸다. */
const rotateOnce: RefreshScript = (setAll) => setAll([ROTATED_0]);
/** 청크 쿠키 — @supabase/ssr 은 큰 토큰을 나눠 쓰며 setAll 이 여러 번 불린다. */
const rotateInTwoBatches: RefreshScript = (setAll) => {
  setAll([ROTATED_0]);
  setAll([ROTATED_1]);
};
/** refresh 실패 — ssr 이 «빈 값 + maxAge 0» 삭제 지시를 내린다. */
const clearSession: RefreshScript = (setAll) => setAll([CLEARED_0]);

function setupRotating(user: { id: string } | null, rows: unknown[], refresh: RefreshScript) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  mocks.createServerClient.mockImplementation(
    (_url: string, _anonKey: string, options: { cookies: { setAll: (cookies: WrittenCookie[]) => void } }) => ({
      auth: {
        getUser: vi.fn(async () => {
          refresh((cookies) => options.cookies.setAll(cookies));
          return { data: { user } };
        }),
      },
      from: vi.fn(() => ({ select })),
    }),
  );
}

function cookieOn(response: NextResponse, name: string) {
  return response.cookies.get(name);
}

describe("proxy carries refreshed session cookies out of every exit (BBE-200)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-test-key";
    mocks.createServerClient.mockReset();
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("① workspace rewrite response carries the rotated cookie", async () => {
    setupRotating({ id: "user-1" }, [membership("org-acme", "acme")], rotateOnce);
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/acme/deals/123"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://www.moa-work.com/deals/123");
    expect(cookieOn(response, ROTATED_0.name)?.value).toBe(ROTATED_0.value);
    // ★ 응답만이 아니라 «rewrite 로 넘어가는 요청» 도 갱신된 쿠키를 들고 가야 한다.
    //   이게 빠지면 그 요청을 처리하는 서버 컴포넌트가 옛 쿠키를 읽는다 (조용히 깨진다).
    expect(response.headers.get("x-middleware-request-cookie")).toContain(`${ROTATED_0.name}=${ROTATED_0.value}`);
    expect(response.headers.get("x-middleware-request-cookie")).toContain("mw_org=org-acme");
  });

  it("② membership-denied redirect carries the rotated cookie", async () => {
    setupRotating({ id: "user-1" }, [membership("org-acme", "acme")], rotateOnce);
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/not-mine/deals/123"));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/workspace-entry?error=routing");
    expect(cookieOn(response, ROTATED_0.name)?.value).toBe(ROTATED_0.value);
  });

  it("③ legacy-path canonicalization redirect carries the rotated cookie", async () => {
    setupRotating({ id: "user-1" }, [membership("org-acme", "acme")], rotateOnce);
    const response = await proxy(new NextRequest("https://www.moa-work.com/boards/board-1?view=table", {
      headers: { cookie: "mw_workspace_slug=acme; mw_org=org-acme" },
    }));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/w/acme/boards/board-1?view=table");
    expect(cookieOn(response, ROTATED_0.name)?.value).toBe(ROTATED_0.value);
  });

  it("④ missing-slug workspace-entry redirect carries the rotated cookie", async () => {
    setupRotating({ id: "user-1" }, [membership("org-acme", "acme")], rotateOnce);
    const response = await proxy(new NextRequest("https://www.moa-work.com/notices"));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/workspace-entry?error=routing");
    expect(cookieOn(response, ROTATED_0.name)?.value).toBe(ROTATED_0.value);
  });

  it("⑤ unauthenticated /login redirect carries the session-clearing directive", async () => {
    // refresh 가 실패하면 ssr 은 «빈 값 + maxAge 0» 을 내린다. 이걸 버리면
    // 브라우저에 무효 쿠키가 남아 재로그인까지 오염된다.
    setupRotating(null, [], clearSession);
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/acme/boards", {
      headers: { cookie: "sb-fake-auth-token.0=stale-fake-value" },
    }));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/login?next=%2Fw%2Facme%2Fboards");
    const cleared = cookieOn(response, CLEARED_0.name);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
  });

  it("⑥ Supabase env 가 없는 경로도 같은 출구를 지난다 (라우팅 함수는 응답을 못 만든다)", async () => {
    // 이 경로는 Supabase 클라이언트를 만들지 않으므로 «오늘» 실을 갱신 쿠키가 없다.
    // 즉 57행은 실재 누수가 아니라 «잠복한 우회 return» 이다. 그래서 쿠키 단언 대신
    // 우회 자체를 막는 구조를 검사한다.
    //
    // 1차 방어는 타입이다 — routeRequest 의 반환형이 RouteDecision 이라 응답 객체를
    // 돌려주려는 순간 `tsc --noEmit`(check.sh) 이 막는다. 사람이 느슨하게 못 만든다.
    // 아래는 그 위의 덤: 라우팅 함수 본문이 응답을 «만들지» 조차 않는지 본다.
    // (return 개수를 세지 않는다 — 정당한 early return 이 늘어도 깨지지 않아야 한다.)
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/acme/boards"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");

    // ★ 줄바꿈 정규화. 이 저장소는 CRLF 와 LF 가 «섞여» 있다 —
    //   `.gitattributes` 는 *.sh · *.mjs · .githooks 만 eol=lf 로 고정하고 **.ts 는 안 덮는다.**
    //   core.autocrlf=true 라서 Windows 에서 새로 checkout 하면 이 파일은 CRLF 로 내려온다.
    //   즉 «누가 어떻게 저장했는가» 에 따라 디스크의 바이트가 달라진다. 문자열로 소스를
    //   훑는 검사는 그 차이에 조용히 무력화될 수 있으므로 읽자마자 LF 로 통일한다.
    //   (2026-08-18 DC-15 가 변이 검사에서 CRLF 때문에 앵커가 안 맞아 「변이 생존 = 테스트가
    //    가짜」로 잘못 적을 뻔했다. 같은 뿌리다.)
    const source = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const anchor = "async function routeRequest(";
    // ★ 앵커는 «정확히 1회» 매치해야 한다 (팀 규칙 — 다중 매치는 중단 사유다).
    //   0회·2회를 «한 단언» 으로 잡는다. indexOf === lastIndexOf 로 쓰면 0회일 때
    //   -1 === -1 로 통과해서(fail-open) 방어가 «옆 줄이 살아 있는지» 에 기대게 된다.
    //   방어가 이웃에 의존하면, 이웃을 지우는 사람이 방어를 지운 줄 모른다.
    expect(source.split(anchor).length - 1).toBe(1);
    const start = source.indexOf(anchor);
    let depth = 0;
    let end = -1;
    for (let i = source.indexOf("{", start); i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = source.slice(start, end);

    // ★ fail-closed. 이 중괄호 카운터는 문자열·주석 안의 중괄호를 구분하지 못한다.
    //   그런 게 들어와 본문이 «조기에» 잘리면 아래 NextResponse 단언이 «공허하게»
    //   통과한다 — 계측 도구가 «판정 불능» 을 «통과» 로 접는 것이다. 그래서 먼저
    //   «본문을 통째로 제대로 떠냈는지» 를 검사한다. 못 떠냈으면 그 자체가 빨간불이다.
    expect(end).toBeGreaterThan(start);
    for (const marker of ["getSupabaseEnv", "decideWorkspaceNamespace", "protectedWorkspacePath", "return { kind: \"pass\" };"]) {
      expect(body).toContain(marker);
    }

    expect(body.match(/NextResponse\s*\./g) ?? []).toHaveLength(0);
  });

  it("⑦ keeps every setAll batch when Supabase writes chunked cookies", async () => {
    // splice 는 «누적» 이 아니라 «치환» 이다 — 첫 배치가 통째로 사라진다.
    setupRotating({ id: "user-1" }, [membership("org-acme", "acme")], rotateInTwoBatches);
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/acme/deals/123"));
    expect(cookieOn(response, ROTATED_0.name)?.value).toBe(ROTATED_0.value);
    expect(cookieOn(response, ROTATED_1.name)?.value).toBe(ROTATED_1.value);
  });

  it("⑧ 회귀 가드 — 출구가 요청 쿠키를 되살리지 않는다 (로그아웃이 되살아나면 안 된다)", async () => {
    // ★ 이 테스트는 «이 PR 이 고친 버그» 를 재현하지 않는다. 수정 전 코드에서도 통과한다.
    //   막는 대상은 앞으로의 회귀다 — 출구가 «요청 쿠키를 응답에 되싣는» 식으로 바뀌면
    //   삭제 지시가 옛 값으로 덮여 로그아웃이 되살아난다. 출구는 ssr 이 준 것만 싣는다.
    //   (이 PR 의 증거로 오해하지 마라. 증거는 ①~⑦ 과 변이표다.)
    setupRotating(null, [], clearSession);
    const response = await proxy(new NextRequest("https://www.moa-work.com/auth/signout", {
      headers: { cookie: "sb-fake-auth-token.0=stale-fake-value" },
    }));
    const cleared = cookieOn(response, CLEARED_0.name);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("stale-fake-value");
  });

  it("⑨ 접근 거부 응답은 mw_org 를 삭제한다 (갱신 쿠키에 덮이지 않는다)", async () => {
    // 이번 리팩터가 «순서를 옮긴 바로 그 지점». 구·신 테스트 모두 단언이 없었다.
    setupRotating({ id: "user-1" }, [membership("org-acme", "acme")], rotateOnce);
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/not-mine/deals/123", {
      headers: { cookie: "mw_org=org-acme" },
    }));
    const org = cookieOn(response, "mw_org");
    expect(org?.value).toBe("");
    expect(cookieOn(response, ROTATED_0.name)?.value).toBe(ROTATED_0.value);
  });

  it("⑩ alias 리다이렉트(/acme → /w/acme)도 갱신 쿠키·mw_org·slug 를 싣는다", async () => {
    setupRotating({ id: "user-1" }, [membership("org-acme", "acme")], rotateOnce);
    const response = await proxy(new NextRequest("https://www.moa-work.com/acme?tab=notes"));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/w/acme?tab=notes");
    expect(cookieOn(response, ROTATED_0.name)?.value).toBe(ROTATED_0.value);
    expect(cookieOn(response, "mw_org")?.value).toBe("org-acme");
    expect(cookieOn(response, "mw_workspace_slug")?.value).toBe("acme");
  });

  it("⑪ Set-Cookie 순서 고정 — 갱신 세션 쿠키가 라우팅 쿠키보다 «먼저»", async () => {
    // ★ 주석으로만 적어두면 다음 사람이 «정리» 하다 뒤집는다. 실제로 헤더가 달라지는데
    //   (DC-12 가 변이로 실측) 아무 테스트도 안 잡던 자리다 — 「지키지 않는 것을
    //   지킨다고 적어둔 상태」였다. 이름 충돌은 오늘 없지만, 순서 자체를 못박는다.
    setupRotating({ id: "user-1" }, [membership("org-acme", "acme")], rotateOnce);
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/acme/deals/123"));
    const setCookie = response.headers.get("set-cookie") ?? "";
    const refreshedAt = setCookie.indexOf(`${ROTATED_0.name}=`);
    const routingAt = setCookie.indexOf("mw_org=");
    expect(refreshedAt).toBeGreaterThanOrEqual(0);
    expect(routingAt).toBeGreaterThanOrEqual(0);
    expect(refreshedAt).toBeLessThan(routingAt);
  });
});

describe("proxy workspace namespace", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-test-key";
    mocks.createServerClient.mockReset();
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("injects selected mw_org into the same rewritten request for a 2+ exact target", async () => {
    setup({ id: "user-1" }, [membership("org-alpha", "alpha-team"), membership("org-acme", "acme")]);
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/acme/deals/123?tab=notes"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://www.moa-work.com/deals/123?tab=notes");
    expect(response.headers.get("x-middleware-request-cookie")).toContain("mw_org=org-acme");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-acme");
  });

  it("adds one app-tab signal without changing rewrite or refreshed cookies", async () => {
    setupRotating({ id: "user-1" }, [membership("org-acme", "acme")], rotateOnce);
    const response = await proxy(new NextRequest("https://www.moa-work.com/w/acme/work"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://www.moa-work.com/work");
    expect(response.headers.get("x-middleware-request-x-mw-app-tab")).toBe("1");
    expect(response.headers.get("x-middleware-request-cookie")).toContain("mw_org=org-acme");
    expect(cookieOn(response, ROTATED_0.name)?.value).toBe(ROTATED_0.value);

    const deepLink = await proxy(new NextRequest("https://www.moa-work.com/w/acme/deals/123", {
      headers: { "x-mw-app-tab": "1" },
    }));
    expect(deepLink.headers.get("x-middleware-request-x-mw-app-tab")).toBeNull();
    expect(deepLink.headers.get("x-middleware-rewrite")).toBe("https://www.moa-work.com/deals/123");
  });

  it("canonicalizes an unauthenticated alias in login next without opening reserved routes", async () => {
    setup(null);
    const response = await proxy(new NextRequest("https://www.moa-work.com/acme?tab=notes"));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/login?next=%2Fw%2Facme%3Ftab%3Dnotes");
    const reserved = await proxy(new NextRequest("https://www.moa-work.com/settings"));
    expect(reserved.headers.get("location")).toBe("https://www.moa-work.com/login?next=%2Fsettings");
  });

  it("canonicalizes legacy protected root links to the verified workspace", async () => {
    setup({ id: "user-1" }, [membership("org-acme", "acme")]);
    const namespaced = await proxy(new NextRequest("https://www.moa-work.com/w/acme/notices"));
    expect(namespaced.headers.get("set-cookie")).toContain("mw_workspace_slug=acme");

    const request = new NextRequest("https://www.moa-work.com/boards/board-1?view=table", {
      headers: { cookie: "mw_workspace_slug=acme; mw_org=org-acme" },
    });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/w/acme/boards/board-1?view=table");

    const settings = await proxy(new NextRequest("https://www.moa-work.com/settings/account", {
      headers: { cookie: "mw_workspace_slug=acme; mw_org=org-acme" },
    }));
    expect(settings.headers.get("location")).toBe("https://www.moa-work.com/w/acme/settings/account");

    const settlements = await proxy(new NextRequest("https://www.moa-work.com/settlements?dealId=deal-1", {
      headers: { cookie: "mw_workspace_slug=acme; mw_org=org-acme" },
    }));
    expect(settlements.headers.get("location")).toBe("https://www.moa-work.com/w/acme/settlements?dealId=deal-1");
  });

  it("fails closed for a protected root link without a verified workspace slug", async () => {
    setup({ id: "user-1" }, [membership("org-acme", "acme")]);
    const response = await proxy(new NextRequest("https://www.moa-work.com/notices"));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/workspace-entry?error=routing");
  });
});
