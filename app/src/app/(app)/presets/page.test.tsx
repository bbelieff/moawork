import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PresetsPage from "./page";

describe("PresetsPage (BBE-156)", () => {
  it("먼데이 복제분을 제품 기본 프리셋으로 노출하지 않는다", () => {
    const html = renderToStaticMarkup(<PresetsPage />);

    expect(html).toContain("아이템 프리셋 0");
    expect(html).toContain("등록된 제품 기본 프리셋이 없습니다");
    expect(html).toContain("이관 때만 사용하는 매핑 사전");
    expect(html).not.toContain("data-preset-name");
  });

  it("뷰 프리셋 미구현 상태를 유지한다", () => {
    const html = renderToStaticMarkup(<PresetsPage />);
    expect(html).toContain("뷰 프리셋 연결은 아직 없어요");
  });
});
