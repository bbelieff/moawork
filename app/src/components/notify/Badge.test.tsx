import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { PANEL_SCROLL_CLASS, PANEL_WIDTH_CLASS, panelWidthAt } from "./layout";
import { computeBadge } from "@/lib/notify/badge";

describe("Badge 렌더", () => {
  it("뱃지가 없으면 아무것도 그리지 않는다", () => {
    expect(renderToStaticMarkup(<Badge state={{ kind: "none" }} />)).toBe("");
  });

  it("점은 숫자를 그리지 않고 상태만 알린다", () => {
    const html = renderToStaticMarkup(<Badge state={{ kind: "dot" }} label="공지사항" />);
    expect(html).toContain("공지사항 안 본 변화 있음");
    expect(html).not.toMatch(/>\d+</);
  });

  it("숫자는 건수를 그대로 보여준다", () => {
    const html = renderToStaticMarkup(
      <Badge state={computeBadge({ actionCount: 3, hasUnseen: false })} label="멤버관리" />,
    );
    expect(html).toContain(">3<");
    expect(html).toContain("멤버관리 할 일 3건");
  });

  it("99 초과는 99+ 로 그린다", () => {
    const html = renderToStaticMarkup(
      <Badge state={computeBadge({ actionCount: 128, hasUnseen: true })} />,
    );
    expect(html).toContain(">99+<");
    // 실제 건수는 보조 설명으로 유지된다.
    expect(html).toContain("할 일 128건");
  });

  it("스크린리더가 상태 변화를 인지하도록 role=status 를 단다", () => {
    expect(renderToStaticMarkup(<Badge state={{ kind: "dot" }} />)).toContain('role="status"');
  });
});

describe("★ 375px 무깨짐", () => {
  it("패널 폭은 뷰포트를 넘지 않는다", () => {
    // min(360, vw-24): 375px 에서 351px → 가로 스크롤 없음.
    expect(panelWidthAt(375)).toBe(351);
    expect(panelWidthAt(375)).toBeLessThan(375);
    // 넓은 화면에서는 360px 로 고정.
    expect(panelWidthAt(1280)).toBe(360);
  });

  it("폭 클래스가 뷰포트 기준 계산을 포함한다", () => {
    expect(PANEL_WIDTH_CLASS).toContain("100vw-24px");
    expect(PANEL_WIDTH_CLASS).toContain("min(360px");
  });

  it("목록은 패널 내부에서만 세로 스크롤한다", () => {
    expect(PANEL_SCROLL_CLASS).toContain("overflow-y-auto");
    // min-h-0 이 없으면 flex 자식이 줄지 않아 패널이 화면을 밀어낸다.
    expect(PANEL_SCROLL_CLASS).toContain("min-h-0");
  });
});
