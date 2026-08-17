import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "./GlobalSearch";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// BBE-194 — 상단바 검색 트리거의 «문구와 치수» 회귀 방지.
// 총괄: 「검색하거나 빠르게 만들기 이거는 왜 있는지 모르겠어」 + 「만들 / 기」로 줄바꿈이 깨짐.

describe("BBE-194 전체 검색 트리거", () => {
  // 되돌리면 빨개진다: 문구를 「검색하거나 빠르게 만들기」로 되돌리면 실패
  it("목업 v6 문구 「전체 검색」을 쓴다", () => {
    const html = renderToStaticMarkup(<GlobalSearch />);

    expect(html).toContain("전체 검색");
    // 옛 문구는 사이드바 220px 안에서 «빠르게 만들 / 기» 로 잘렸다.
    expect(html).not.toContain("검색하거나 빠르게 만들기");
  });

  // 되돌리면 빨개진다: 트리거를 <div> 장식으로 되돌리거나 aria 를 떼면 실패
  it("진짜로 눌리는 버튼이다 — 장식이 아니다", () => {
    const html = renderToStaticMarkup(<GlobalSearch />);

    expect(html).toMatch(/<button[^>]*type="button"[^>]*>/);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="전체 검색"');
  });

  // 되돌리면 빨개진다: 좁은 화면에서 문구를 항상 보이게 하면(=lg 분기 제거) 실패.
  // 375px 에서 문구까지 그리면 벨·테마·계정을 밀어내고 다시 줄바꿈이 깨진다.
  it("좁은 화면에서는 아이콘만 남는다", () => {
    const html = renderToStaticMarkup(<GlobalSearch />);
    const label = html.match(/<span[^>]*>전체 검색<\/span>/)?.[0] ?? "";

    expect(label).toContain("hidden");
    expect(label).toContain("lg:inline");
  });

  // 되돌리면 빨개진다: 하드코딩 px·hex 를 넣거나, 존재하지 않는 --mw-border 로 되돌리면 실패.
  it("치수와 색을 토큰으로만 잡는다", () => {
    const source = readFileSync(new URL("./GlobalSearch.tsx", import.meta.url), "utf8");

    // --mw-border 는 어디에도 정의돼 있지 않다(정본은 --mw-line). 쓰면 테두리가 사라진다.
    expect(source).not.toContain("--mw-border");
    expect(source).toContain("var(--mw-shell-search-w)");
    expect(source).toContain('height: "var(--mw-shell-iconbtn-size)"');
  });
});
