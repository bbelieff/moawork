import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TabView } from "@/lib/view";
import { ViewPicker } from "./ViewPicker";

function view(overrides: Partial<TabView>): TabView {
  return {
    id: "v1",
    orgId: "org-1",
    boardKey: "new",
    ownerId: "카뮈",
    name: "내 담당",
    kind: "board",
    visibility: "shared",
    personScope: "viewer",
    personScopeUserId: null,
    filters: {},
    sort: [],
    hiddenColumns: [],
    columnOrder: [],
    calendarFieldKey: null,
    createdAt: "2026-08-11T00:00:00Z",
    updatedAt: "2026-08-11T00:00:00Z",
    ...overrides,
  };
}

describe("ViewPicker", () => {
  it("공용/나만 뷰를 그룹으로 나누고 동적 배지를 붙인다(D25·D26)", () => {
    const views = [
      view({ id: "shared-1", name: "내 담당", visibility: "shared", personScope: "viewer" }),
      view({ id: "mine-1", name: "오늘 통화할 곳", visibility: "private", ownerId: "카뮈", personScope: "none" }),
    ];
    const html = renderToStaticMarkup(
      <ViewPicker views={views} current={{ system: true, kind: "board", name: "보드" }} currentUserId="카뮈" onSelect={() => {}} onRequestSave={() => {}} />,
    );
    expect(html).toContain("회사 공용");
    expect(html).toContain("나만 보기");
    expect(html).toContain("내 담당");
    expect(html).toContain("오늘 통화할 곳");
    expect(html).toContain("나</span>"); // dynamicBadge "나"
  });

  it("hiddenCount가 있으면 «권한 밖 N건 숨김»을 보여준다(D24)", () => {
    const html = renderToStaticMarkup(
      <ViewPicker views={[]} current={{ system: true, kind: "board", name: "보드" }} currentUserId="카뮈" hiddenCount={3} onSelect={() => {}} onRequestSave={() => {}} />,
    );
    expect(html).toContain("권한 밖 3건 숨김");
  });

  it("hiddenCount가 0이면 배지를 보여주지 않는다", () => {
    const html = renderToStaticMarkup(
      <ViewPicker views={[]} current={{ system: true, kind: "board", name: "보드" }} currentUserId="카뮈" hiddenCount={0} onSelect={() => {}} onRequestSave={() => {}} />,
    );
    expect(html).not.toContain("숨김");
  });
});
