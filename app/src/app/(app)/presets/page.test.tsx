import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SEOUL_STRUCTURE_PACK, allSectionPresets } from "@/lib/structure-packs";
import PresetsPage from "./page";

describe("PresetsPage — 프리셋 라이브러리 (BBE-142)", () => {
  it("아이템 프리셋 실제 개수를 값으로 보여준다(하드코딩 32 아님)", () => {
    const html = renderToStaticMarkup(<PresetsPage />);
    const count = allSectionPresets().length;
    expect(html).toContain(`아이템 프리셋 ${count}`);
  });

  it("보드별로 그룹 칩을 렌더한다 — 팩 실제 보드 이름 사용", () => {
    const html = renderToStaticMarkup(<PresetsPage />);
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      expect(html).toContain(board.name);
      expect(html).toContain(`${board.sections.length}개`);
    }
  });

  it("뷰 프리셋은 미구현을 정직하게 표시한다 — 가짜 개수를 만들지 않는다", () => {
    const html = renderToStaticMarkup(<PresetsPage />);
    expect(html).toContain("뷰 프리셋 연결은 아직 없어요");
    expect(html).not.toMatch(/뷰 프리셋 \d/);
  });
});
