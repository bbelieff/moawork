import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SavedBoardView } from "@/lib/view/board-saved";
import { ViewPicker } from "./ViewPicker";

const view: SavedBoardView = {
  id: "v1",
  name: "오늘 통화할 곳",
  visibility: "private",
  ownerId: "u1",
  isDefault: false,
  lastUsedAt: null,
  config: {
    kind: "table",
    filters: { q: "", assignees: [], byColumn: {}, sortKey: "", sortDir: "asc", columnLimit: 0 },
    groupBy: "",
    layout: {},
    hiddenColumns: [],
    columnOrder: [],
    calendarFieldKey: null,
    sorts: [],
    textMode: "single",
    focusColumnKey: null,
  },
};

describe("ViewPicker", () => {
  it("manages the active persisted view instead of duplicating the tab selector", () => {
    const html = renderToStaticMarkup(<ViewPicker view={view} editable onRename={() => {}} onDelete={() => {}} />);
    expect(html).toContain("뷰 관리");
    expect(html).toContain("오늘 통화할 곳");
    expect(html).toContain("이름 저장");
    expect(html).toContain("뷰 삭제");
    expect(html).not.toContain("메인 테이블");
  });

  it("does not expose mutations for a shared view owned by another member", () => {
    const html = renderToStaticMarkup(<ViewPicker view={{ ...view, visibility: "shared", ownerId: "u2" }} editable={false} onRename={() => {}} onDelete={() => {}} />);
    expect(html).toContain("만든 사람 또는 회사 관리자가");
    expect(html).not.toContain("뷰 삭제");
  });
});
