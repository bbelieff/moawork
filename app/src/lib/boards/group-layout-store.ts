import type { BoardView } from "./types";

export const GROUP_LAYOUT_VIEW_NAME = "__moawork_group_column_layout_v1__";
export const GROUP_LAYOUT_MARKER = "group-column-layout-v1";

export function isGroupLayoutView(view: Pick<BoardView, "name" | "filters_jsonb">): boolean {
  return view.name === GROUP_LAYOUT_VIEW_NAME
    && view.filters_jsonb?.system === GROUP_LAYOUT_MARKER;
}

export function decodeGroupColumnOrder(value: unknown): Record<string, string[]> {
  if (!Array.isArray(value) || value.length !== 1) return {};
  const payload = value[0];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};

  const result: Record<string, string[]> = {};
  for (const [groupKey, columnKeys] of Object.entries(payload)) {
    if (!Array.isArray(columnKeys) || !columnKeys.every((key) => typeof key === "string")) continue;
    result[groupKey] = [...columnKeys];
  }
  return result;
}

export function encodeGroupColumnOrder(order: Record<string, string[]>): unknown[] {
  return [{ ...order }];
}
