import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaveViewDialog } from "./SaveViewDialog";

describe("SaveViewDialog", () => {
  it("기본 사람 조건은 «보는 사람 기준»이다(D26)", () => {
    const html = renderToStaticMarkup(
      <SaveViewDialog orgId="org-1" boardKey="new" ownerId="카뮈" kind="flat" filters={{ 시도: ["서울"] }} onSubmit={() => {}} />,
    );
    expect(html).toContain("보는 사람 기준");
    expect(html).toContain("1개");
    expect(html).toMatch(/checked/); // viewer 라디오가 checked
  });

  it("people을 넘기면 «특정 사람 고정» 옵션이 보인다", () => {
    const html = renderToStaticMarkup(
      <SaveViewDialog
        orgId="org-1"
        boardKey="new"
        ownerId="카뮈"
        kind="board"
        filters={{}}
        people={[{ id: "u1", name: "박정화 실장" }]}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain("특정 사람 고정");
  });

  it("people이 없으면 «특정 사람 고정» 옵션이 없다", () => {
    const html = renderToStaticMarkup(<SaveViewDialog orgId="org-1" boardKey="new" ownerId="카뮈" kind="board" filters={{}} onSubmit={() => {}} />);
    expect(html).not.toContain("특정 사람 고정");
  });

  it("긴 권한 안내 대신 실제 공개 범위 선택을 제공한다", () => {
    const html = renderToStaticMarkup(<SaveViewDialog orgId="org-1" boardKey="new" ownerId="카뮈" kind="board" filters={{}} onSubmit={() => {}} />);
    expect(html).toContain('aria-label="공개 범위"');
    expect(html).toContain("나만");
    expect(html).toContain("회사 전체");
  });

  it("creates only supported real view kinds and enables calendar when a date column exists", () => {
    const html = renderToStaticMarkup(
      <SaveViewDialog
        orgId="org-1"
        boardKey="new"
        ownerId="u1"
        kind="flat"
        filters={{}}
        dateColumns={[{ key: "due", label: "예정일" }]}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain("보기 방식");
    expect(html).toContain("표");
    expect(html).toContain("보드");
    expect(html).toContain("캘린더");
    expect(html).not.toContain('value="cal" disabled');
  });
});
