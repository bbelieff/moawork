// BBE-214 — 「본문이 비는 동안 «로딩 중» 이 보인다」를 «보이는지» 로 잰다.
//
// ★ 이 테스트가 무엇을 관측하는가
//   「코드에 loading.tsx 가 있다」가 아니라 **그것을 그렸을 때 사람이 읽을 글자가 나오는가** 를 잰다.
//   그래서 아래 변이가 전부 빨개진다:
//     · loading.tsx 를 지운다      → import 가 깨진다
//     · 라벨을 빈 문자열로 바꾼다   → 「보이는 글자 0」으로 걸린다
//     · aria-hidden / hidden 으로 감춘다 → 감춤 검사에 걸린다
//     · default export 를 개명한다  → 기본 내보내기가 없어 걸린다

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import BoardDetailLoading from "./boards/[id]/loading";
import BoardsLoading from "./boards/loading";
import CompaniesLoading from "./companies/loading";
import ContactLoading from "./contract/loading";
import NewCustomerLoading from "./newcust/loading";
import NoticesLoading from "./notices/loading";
import PresetsLoading from "./presets/loading";
import WorkLoading from "./work/loading";

/** 화면에 실제로 남는 «읽을 수 있는 글자» 만 뽑는다 — 감춰진 것은 빼고 센다. */
function visibleText(html: string): string {
  // `s`(dotAll) 플래그는 이 저장소의 tsconfig target 에서 못 쓴다 — [\s\S] 로 같은 일을 한다.
  const withoutHidden = html
    .replace(/<[^>]*\baria-hidden="true"[^>]*>[\s\S]*?<\/[^>]+>/g, "")
    .replace(/<[^>]*\bhidden\b[^>]*>[\s\S]*?<\/[^>]+>/g, "");
  return withoutHidden.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

const ROUTES: ReadonlyArray<readonly [string, () => React.JSX.Element]> = [
  ["/boards/[id]", BoardDetailLoading],
  ["/boards", BoardsLoading],
  ["/newcust", NewCustomerLoading],
  ["/contract", ContactLoading],
  ["/work", WorkLoading],
  ["/companies", CompaniesLoading],
  ["/notices", NoticesLoading],
  ["/presets", PresetsLoading],
];

describe("BBE-214 · 화면이 비는 동안 「로딩 중」이 보인다", () => {
  it.each(ROUTES)("%s — 로딩 표시에 읽을 수 있는 글자가 «보인다»", (route, Loading) => {
    const html = renderToStaticMarkup(<Loading />);
    const text = visibleText(html);

    // 「보인다」의 최소 조건 — 감춰지지 않은 글자가 실제로 있다.
    expect(text.length, `${route} 의 로딩 표시에 보이는 글자가 없다`).toBeGreaterThan(0);
    // 흰 화면과 구분되려면 «기다리는 중» 이라고 «말해야» 한다.
    expect(text, `${route} 의 로딩 표시가 로딩 중임을 말하지 않는다`).toMatch(/중이에요|중입니다|불러오는|여는/);
    // 화면을 못 보는 사용자에게도 같은 사실이 전달되어야 한다.
    expect(html, `${route} 의 로딩 표시에 role=status 가 없다`).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });

  // 총괄이 실제로 겪은 경로다: 탭을 누르면 경유지(/contract)가 서버 왕복을 한 벌 태우고
  // 그다음 /boards/[id] 가 또 한 벌 태운다. **두 구간 다** 비어 있으면 안 된다.
  it("탭 클릭이 지나는 두 구간 모두 로딩 표시를 갖는다", () => {
    for (const Loading of [ContactLoading, BoardDetailLoading]) {
      expect(visibleText(renderToStaticMarkup(<Loading />)).length).toBeGreaterThan(0);
    }
  });
});
