// BBE-214 — 「툴팁이 화면 전환 뒤에 남지 않는다」
//
// ★ 이 테스트가 관측하는 것과, 관측하지 «못하는» 것
//
//   총괄 스크린샷: 본문이 통째로 빈 상태에서 이미 떠난 탭의 툴팁(「리드컨택 관리」)이
//   화면 한가운데 떠 있었다. 그 글자는 정확히 `tab.mockupLabel` 값이다.
//
//   원인은 «네이티브 title 속성» 이다. 두 조건이 겹쳐야 이 잔상이 생긴다:
//     ① 브라우저가 그린 title 툴팁은 **앱이 지울 수 없다** — 없앨 API 가 없다.
//     ② 이 <nav> 는 app/(app)/layout.tsx 에 있어 **화면을 옮겨도 언마운트되지 않는다**
//        (바뀌는 것은 <main>{children}</main> 뿐이다). 그래서 툴팁을 물고 있는
//        바로 그 <a> 가 새 화면에서도 그대로 살아 있다.
//
//   ★ 「호버 뒤 화면을 옮기면 툴팁이 사라진다」를 이 테스트가 직접 볼 수는 없다 —
//     네이티브 툴팁은 DOM 에 없고 브라우저 크롬이 그린다. 그래서 **원인을 잰다**:
//     «전환에도 살아남는 이 링크에 네이티브 툴팁이 애초에 달려 있지 않다.»
//     달려 있지 않으면 남을 것도 없다. 이름도 그렇게 붙였다.
//
//   ※ 정보는 줄지 않았다(§9.3) — title 값은 바로 옆 <span>{tab.mockupLabel}</span> 과
//     «같은 글자» 였다. 즉 이 툴팁은 보이는 라벨을 그대로 되풀이할 뿐이었다.
//     아래 첫 번째 테스트가 그 사실 자체를 못 박는다.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_TABS } from "./app-tabs";

const pathname = vi.hoisted(() => ({ current: "/presets" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

async function render(path: string, lockedFeatures: string[] = []) {
  pathname.current = path;
  const { AppTabs } = await import("./AppTabs");
  return renderToStaticMarkup(
    <AppTabs lockedFeatures={lockedFeatures} workspaceBasePath="/w/sample-lab" />,
  );
}

describe("BBE-214 · 탭 줄의 툴팁 잔상", () => {
  it("탭 라벨은 여전히 «보인다» — 툴팁을 뗐다고 정보가 사라지지 않았다", async () => {
    const html = await render("/w/sample-lab/presets");
    for (const tab of APP_TABS) {
      if (!tab.canonicalHref) continue;
      expect(html, `${tab.key} 의 라벨이 화면에서 사라졌다`).toContain(tab.mockupLabel);
    }
  });

  it("화면 전환에도 살아남는 탭 링크에 네이티브 title 툴팁이 없다", async () => {
    const html = await render("/w/sample-lab/presets");
    const tabLinks = [...html.matchAll(/<a[^>]*data-tab-key="[^"]*"[^>]*>/g)].map((m) => m[0]);

    // 하니스 자체 검증 — 링크를 실제로 찾았는가. 0개면 아래 단언이 공허하게 통과한다.
    expect(tabLinks.length, "탭 링크를 하나도 못 찾았다 — 이 테스트는 아무것도 검사하지 못한다").toBe(6);

    for (const link of tabLinks) {
      expect(link, `이 탭 링크에 네이티브 title 툴팁이 있다 — 화면을 옮겨도 지워지지 않는다: ${link}`)
        .not.toMatch(/\stitle=/);
    }
  });

  it("잠금 표시를 포함해 탭 줄 어디에도 네이티브 title 이 없다", async () => {
    // 잠긴 탭이 있어도 마찬가지다. 이 <nav> 안의 title 은 전부 전환을 넘어 살아남는다.
    const html = await render("/w/sample-lab/presets", ["work.view_tabs", "company.view"]);
    expect(html).not.toMatch(/\stitle=/);
  });
});
