// BBE-214 — 「보드 이름 → 보기(저장된 뷰) → 필터」 순서를 «그려진 결과» 로 잰다.
// #845 6단계(2026-10-08) — 저장된 뷰 줄·필터 줄이 «보기 줄» 하나로 합쳐졌다.
//   그래서 «뷰 탭 → 보기 조건 칩 → 찾기» 가 한 줄 안에서 이 순서로 서는지를 잰다.
//
// ★ 근거는 목업이다 (docs/design/UI목업_워크스페이스_최종_v6.html, function head()):
//     :1810  <div class="h1">${t.label}</div>          ← 보드 이름   (.hrow)
//     :1821  <div class="vrow"><span class="vlab">보기</span>  ← 보기
//     :1841  function filterbar(t){ …                   ← 필터
//   뷰는 «보드에 속한 것» 이다. 소속된 것이 소속처보다 위에 있으면 위계가 뒤집혀 보인다.
//
// ★ 이 테스트가 관측하는 것: HTML 안의 «등장 위치» 다. 소스 코드의 줄 순서가 아니다.
//   보기 줄을 BoardHeader 위로 되돌리거나, 보기 줄 렌더를 빼서 배선을 끊으면 빨개진다.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/boards/board-1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { BoardWorkspace } from "./BoardWorkspace";

const BOARD = {
  id: "board-1",
  org_id: "org-1",
  name: "보드이름표식",
  icon: null,
  description: null,
  source: "core.default-tab/contact",
  is_system: false,
  sort_order: 0,
} as never;

function renderWorkspace() {
  return renderToStaticMarkup(
    <BoardWorkspace
      board={BOARD}
      columns={[]}
      groups={[]}
      rows={[]}
      columnOrder={{}}
      cellFlash={null}
      assigneeLabels={{}}
    />,
  );
}

describe("BBE-214 · 보드 화면의 세로 순서 — 이름이 먼저, 뷰가 그 아래", () => {
  it("보드 이름이 보기 줄(뷰 탭)보다 «위» 에 그려진다", () => {
    const html = renderWorkspace();
    const nameAt = html.indexOf("보드이름표식");
    const viewsAt = html.indexOf("data-board-view-bar");

    // 하니스 자체 검증 — 둘 다 실제로 그려졌는가. 하나라도 없으면 비교가 공허하다.
    expect(nameAt, "보드 이름이 안 그려졌다 — 이 테스트는 아무것도 비교하지 못한다").toBeGreaterThan(-1);
    expect(viewsAt, "보기 줄이 안 그려졌다 — 배선이 끊겼다").toBeGreaterThan(-1);

    expect(nameAt, "보기 줄이 보드 이름보다 위에 있다 — 목업 head() 순서가 뒤집혔다")
      .toBeLessThan(viewsAt);
  });

  it("한 줄 안에서 뷰 탭 → 보기 조건 칩 → 찾기 순서로 선다", () => {
    const html = renderWorkspace();
    const row = html.match(/<div[^>]*data-board-toolbar[\s\S]*?data-view-count[^>]*>/)?.[0] ?? "";
    const tabsAt = row.indexOf("메인 테이블");
    const chipsAt = row.indexOf("골라 보기");
    const searchAt = row.indexOf('aria-label="찾기"');

    // ★ 셋 다 «같은 줄» 에서 찾는다 — 하나라도 -1 이면 그 줄에서 빠진 것이다.
    expect(tabsAt, "뷰 탭이 보기 줄에 없다").toBeGreaterThan(-1);
    expect(chipsAt, "보기 조건 칩이 보기 줄에 없다").toBeGreaterThan(-1);
    expect(searchAt, "찾기가 보기 줄에 없다").toBeGreaterThan(-1);
    expect(tabsAt).toBeLessThan(chipsAt);
    expect(chipsAt).toBeLessThan(searchAt);
    // 예전 묶음 이름(찾기·보기·저장 꼬리표)과 「뷰로 저장」 단추는 없다.
    expect(html).not.toContain(">뷰로 저장<");
    expect(html).not.toContain(">저장</span>");
  });
});
