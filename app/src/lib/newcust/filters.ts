import type { BoardColumn, FileCapableItemWithValues } from "@/lib/boards/types";

export type NewcustFilters = { query: string; assignee: string; status: string; sort: string; currentUserId?: string };

export function visibleNewcustItems(items: FileCapableItemWithValues[], columns: BoardColumn[], filters: NewcustFilters): FileCapableItemWithValues[] {
  const statusKey = columns.find((column) => column.key === "contact_status")?.key;
  const query = filters.query.trim().toLocaleLowerCase("ko");
  const filtered = items.filter((item) => {
    if (query && ![item.title, ...Object.values(item.values).map(String)].some((value) => value.toLocaleLowerCase("ko").includes(query))) return false;
    if (filters.assignee === "mine" && item.assigned_to !== filters.currentUserId) return false;
    if (filters.assignee === "none" && item.assigned_to) return false;
    if (filters.status && statusKey && item.values[statusKey] !== filters.status) return false;
    return true;
  });
  return filtered.sort((a, b) => {
    if (filters.sort === "name") return a.title.localeCompare(b.title, "ko");
    if (filters.sort === "revenue") return Number(b.values.expected_revenue ?? 0) - Number(a.values.expected_revenue ?? 0);
    return a.sort_order - b.sort_order;
  });
}
