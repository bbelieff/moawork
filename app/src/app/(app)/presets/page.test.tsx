import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SEOUL_STRUCTURE_PACK } from "@/lib/structure-packs";
import PresetsPage from "./page";

describe("PresetsPage — 프리셋 라이브러리 (BBE-142)", () => {
  it("아이템 프리셋 실제 총 개수를 값으로 보여준다(하드코딩 아님)", () => {
    const html = renderToStaticMarkup(<PresetsPage />);
    const total = SEOUL_STRUCTURE_PACK.boards.reduce((n, b) => n + b.sections.length, 0);
    expect(html).toContain(`아이템 프리셋 ${total}`);
  });

  it("카드마다 목업 형식대로 출처 보드(목업 라벨)·컬럼 수·공식 배지를 보여준다", () => {
    const html = renderToStaticMarkup(<PresetsPage />);
    // 목업 원문(UI목업_워크스페이스_최종_v6.html:1115) 형식: [아이콘,이름,출처보드,"N컬럼",배지]
    expect(html).toContain("신규리드 관리");
    expect(html).toContain("리드컨택 관리");
    expect(html).toContain("계약업체 실무");
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      expect(html).toContain(`${board.columns.length}컬럼`);
    }
    expect(html).toContain("공식");
  });

  it("각 프리셋 카드가 실제 section.name 을 데이터 속성으로 노출한다 — 32개 항목 확인 가능", () => {
    const html = renderToStaticMarkup(<PresetsPage />);
    const matches = html.match(/data-preset-name="/g) ?? [];
    const total = SEOUL_STRUCTURE_PACK.boards.reduce((n, b) => n + b.sections.length, 0);
    expect(matches).toHaveLength(total);
  });

  it("뷰 프리셋은 미구현을 정직하게 표시한다 — 가짜 개수를 만들지 않는다", () => {
    const html = renderToStaticMarkup(<PresetsPage />);
    expect(html).toContain("뷰 프리셋 연결은 아직 없어요");
    expect(html).not.toMatch(/뷰 프리셋 \d/);
  });
});
