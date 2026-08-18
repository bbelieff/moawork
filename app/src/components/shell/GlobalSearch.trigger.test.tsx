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
  it("버튼 요소와 대화상자 aria 를 갖춘다", () => {
    const html = renderToStaticMarkup(<GlobalSearch />);

    expect(html).toMatch(/<button[^>]*type="button"[^>]*>/);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="전체 검색"');
  });

  // ★ 위 테스트만으로는 «눌린다» 를 증명하지 못한다 — renderToStaticMarkup 결과에는
  // React 이벤트 핸들러가 아예 찍히지 않기 때문이다. 실제로 onClick 만 떼어내면
  // 마크업은 그대로라 저장소의 어떤 테스트도 빨개지지 않았다(PR #248 검수 지적).
  //
  // 그런데 이 카드의 «원래 결함» 이 바로 «onClick 도 button 도 없는 죽은 장식» 이었다.
  // onClick 이 빠지면 버튼은 보이는데 눌러도 아무 일이 없는 상태 —
  // 총괄이 지적한 그 증상으로 정확히 되돌아간다. 그래서 소스에서 직접 고정한다.
  //
  // 되돌리면 빨개진다: <button> 에서 onClick={() => setOpen(true)} 를 제거
  it("트리거 버튼이 실제로 검색을 연다 (onClick 이 버튼에 붙어 있다)", () => {
    const source = readFileSync(new URL("./GlobalSearch.tsx", import.meta.url), "utf8");

    expect(source).toMatch(/<button[^>]*onClick=\{\(\) => setOpen\(true\)\}/);
  });

  // 되돌리면 빨개진다: Ctrl+K 또는 "/" 단축키 처리를 제거
  // 사이드바에서 상단바로 «자리를 옮겼을 뿐 기능은 그대로» 라는 주장의 나머지 절반이다.
  it("키보드로도 열린다 — Ctrl+K 와 /", () => {
    const source = readFileSync(new URL("./GlobalSearch.tsx", import.meta.url), "utf8");

    expect(source).toContain('event.key.toLowerCase() === "k"');
    expect(source).toContain('event.key === "/"');
    expect(source).toContain('event.key === "Escape"');
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
