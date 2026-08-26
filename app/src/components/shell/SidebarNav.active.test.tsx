import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SidebarNav } from "./SidebarNav";

let pathname = "/w/sample-lab";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

const BASE = "/w/sample-lab";

/** 활성으로 칠해진 항목의 nav key 를 전부 모은다 — «몇 개나 켜졌는가» 도 같이 본다. */
function activeKeys(html: string): string[] {
  return [...html.matchAll(/<a[^>]*data-nav-key="([^"]+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
}

function render(boardNavKeys?: Record<string, string>) {
  return renderToStaticMarkup(
    <SidebarNav lockedFeatures={[]} workspaceBasePath={BASE} boardNavKeys={boardNavKeys} />,
  );
}

describe("사이드바 — 지금 어느 탭인지 색으로 보인다", () => {
  it("보드 화면에서 그 탭이 켜진다 — /work 는 /boards/<id> 로 넘기는 경유지라 주소에 탭 이름이 없다", () => {
    pathname = `${BASE}/boards/board-work`;
    const html = render({ "board-work": "work" });

    expect(activeKeys(html)).toEqual(["work"]);
    // 색으로 구분한다 — 배경이 강조색, 글자가 그 위 대비색.
    const link = html.match(/<a[^>]*data-nav-key="work"[^>]*>/)?.[0] ?? "";
    expect(link).toContain("var(--mw-record)");
    expect(link).toContain("var(--mw-on-accent)");
  });

  it("탭마다 «하나만» 켜진다", () => {
    pathname = `${BASE}/settings/members`;
    expect(activeKeys(render())).toEqual(["members"]);
  });

  it("대시보드는 뿌리 주소일 때만 켜진다", () => {
    pathname = BASE;
    expect(activeKeys(render())).toEqual(["dash"]);

    pathname = `${BASE}/companies`;
    expect(activeKeys(render())).toEqual(["company"]);
  });

  it("지도가 없으면 보드 화면에서 아무것도 켜지 않는다 — 엉뚱한 탭을 켜지 않는다", () => {
    pathname = `${BASE}/boards/board-work`;
    expect(activeKeys(render())).toEqual([]);
  });
});
