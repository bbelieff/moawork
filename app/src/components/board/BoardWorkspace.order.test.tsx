// BBE-214 — 「보드 이름 → 보기(저장된 뷰) → 필터」 순서를 «그려진 결과» 로 잰다.
//
// ★ 근거는 목업이다 (docs/design/UI목업_워크스페이스_최종_v6.html, function head()):
//     :1810  <div class="h1">${t.label}</div>          ← 보드 이름   (.hrow)
//     :1821  <div class="vrow"><span class="vlab">보기</span>  ← 보기
//     :1841  function filterbar(t){ …                   ← 필터
//   뷰는 «보드에 속한 것» 이다. 소속된 것이 소속처보다 위에 있으면 위계가 뒤집혀 보인다.
//
// ★ 이 테스트가 관측하는 것: HTML 안의 «등장 위치» 다. 소스 코드의 줄 순서가 아니다.
//   savedViewsSlot 을 BoardHeader 위로 되돌리거나, 슬롯 렌더를 빼서 배선을 끊으면 빨개진다.

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
      savedViewsSlot={<div data-testid="saved-views-slot">저장된뷰표식</div>}
    />,
  );
}

describe("BBE-214 · 보드 화면의 세로 순서 — 이름이 먼저, 뷰가 그 아래", () => {
  it("보드 이름이 저장된 뷰 줄보다 «위» 에 그려진다", () => {
    const html = renderWorkspace();
    const nameAt = html.indexOf("보드이름표식");
    const viewsAt = html.indexOf("저장된뷰표식");

    // 하니스 자체 검증 — 둘 다 실제로 그려졌는가. 하나라도 없으면 비교가 공허하다.
    expect(nameAt, "보드 이름이 안 그려졌다 — 이 테스트는 아무것도 비교하지 못한다").toBeGreaterThan(-1);
    expect(viewsAt, "저장된 뷰 슬롯이 안 그려졌다 — 배선이 끊겼다").toBeGreaterThan(-1);

    expect(nameAt, "저장된 뷰 줄이 보드 이름보다 위에 있다 — 목업 head() 순서가 뒤집혔다")
      .toBeLessThan(viewsAt);
  });

  it("저장된 뷰 줄이 필터 줄보다 «위» 에 그려진다", () => {
    const html = renderWorkspace();
    const viewsAt = html.indexOf("저장된뷰표식");
    // 필터 줄(BoardToolbar)의 검색 입력이 그 구간의 표지다.
    const filterAt = html.indexOf("검색");

    // ★ 이 두 줄이 없으면 «슬롯을 아예 안 그리는» 변이가 살아남는다 —
    //   indexOf 가 -1 을 돌려주고 -1 은 무엇보다 «앞» 이라 비교가 통과해 버린다.
    //   변이 검사에서 실제로 살아남는 것을 보고 추가했다.
    expect(viewsAt, "저장된 뷰 슬롯이 안 그려졌다 — 배선이 끊겼다").toBeGreaterThan(-1);
    expect(filterAt, "필터 줄을 못 찾았다 — 표지를 다시 골라야 한다").toBeGreaterThan(-1);
    expect(viewsAt, "필터가 저장된 뷰보다 위에 있다 — 목업 순서는 보기 → 필터다")
      .toBeLessThan(filterAt);
  });
});
