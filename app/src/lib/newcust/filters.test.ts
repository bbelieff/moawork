import { describe, expect, it } from "vitest";
import { visibleNewcustItems } from "./filters";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

const column = { key: "contact_status" } as BoardColumn;
const item = (id: string, title: string, assigned: string | null, revenue: number, status = "new"): ItemWithValues => ({ id, org_id: "o1", board_id: "b1", group_id: "g1", title, assigned_to: assigned, sort_order: 0, created_at: "", updated_at: "", values: { expected_revenue: revenue, contact_status: status } });

describe("visibleNewcustItems", () => {
  const items = [item("1", "가나다", "u1", 10), item("2", "테스트", null, 30, "contacted")];
  it("searches and filters the same table rows", () => expect(visibleNewcustItems(items, [column], { query: "테스트", assignee: "", status: "contacted", sort: "" })).toHaveLength(1));
  it("sorts revenue descending", () => expect(visibleNewcustItems(items, [column], { query: "", assignee: "", status: "", sort: "revenue" }).map((row) => row.id)).toEqual(["2", "1"]));
  it("supports unassigned filtering", () => expect(visibleNewcustItems(items, [column], { query: "", assignee: "none", status: "", sort: "" })[0]?.id).toBe("2"));
  it("matches the current assignee exactly", () => expect(visibleNewcustItems(items, [column], { query: "", assignee: "mine", status: "", sort: "", currentUserId: "u1" })[0]?.id).toBe("1"));
});
