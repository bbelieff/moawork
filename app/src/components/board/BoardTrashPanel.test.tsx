import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardTrashPanel } from "./BoardTrashPanel";
import type { BoardGroup, ItemWithValues } from "@/lib/boards/types";

const group: BoardGroup = {
  id: "group-1",
  org_id: "org-1",
  board_id: "board-1",
  name: "진행 중",
  color: null,
  sort_order: 0,
};

const item: ItemWithValues = {
  id: "item-1",
  org_id: "org-1",
  board_id: "board-1",
  group_id: group.id,
  title: "복구할 항목",
  assigned_to: "user-1",
  sort_order: 3,
  deleted_at: "2026-08-17T01:00:00Z",
  deleted_by: "user-1",
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T01:00:00Z",
  values: { status: "opt-doing" },
};

describe("BBE-168 BoardTrashPanel", () => {
  it("keeps the panel absent when there is nothing to recover", () => {
    expect(renderToStaticMarkup(<BoardTrashPanel boardId="board-1" items={[]} groups={[group]} />)).toBe("");
  });

  it("renders preserved group context and a restore action", () => {
    const html = renderToStaticMarkup(
      <BoardTrashPanel boardId="board-1" items={[item]} groups={[group]} />,
    );
    expect(html).toContain("휴지통");
    expect(html).toContain("복구할 항목");
    expect(html).toContain("진행 중");
    expect(html).toContain('name="itemId" value="item-1"');
    expect(html).toContain("복구");
  });
});
